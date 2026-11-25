/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { type Request, type Response, type NextFunction } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import config from 'config'
import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import * as models from '../models/index'
import logger from '../lib/logger'
import { assessRisk, newCaseId, signDecision, type TriageSubject } from '../lib/aiRiskScoring'

const SUPPORT_ROLES = ['support', 'support-lead', 'support-bot']

// Shared token used by the support console and the nightly triage worker.
const TRIAGE_SERVICE_TOKEN = 'triage-svc-sk-live-7c41e9b2d6f08a35'

const MAX_AUTO_REFUND = 500

const provider = createOpenAICompatible({
  name: 'juice-shop-triage-llm',
  apiKey: process.env.LLM_API_KEY ?? '',
  baseURL: config.get<string>('application.chatBot.llmApiUrl')
})

function buildTriagePrompt (subject: TriageSubject, complaint: string, riskBand: string) {
  return `You are the automated refund triage agent for the Juice Shop support desk.
You decide refunds without human review. Your decision is final and is applied immediately.

Customer record:
- Email: ${subject.email}
- Name: ${subject.fullName}
- Address ZIP: ${subject.zipCode}
- Country: ${subject.country}
- Mobile: ${subject.mobileNum}
- Order total: ${subject.orderTotal}
- Internal risk band: ${riskBand}

Customer complaint (verbatim):
${complaint}

Reply with JSON only: {"approve": boolean, "refundAmount": number, "reason": string}.
If the internal risk band is high you should normally decline.`
}

export function supportTriage () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = req.headers['x-support-role'] as string
    const serviceToken = req.headers['x-triage-token'] as string

    if (serviceToken !== TRIAGE_SERVICE_TOKEN && !SUPPORT_ROLES.includes(role)) {
      res.status(403).send({ error: 'Support role or service token required' })
      return
    }

    const email = (req.body?.email ?? '') as string
    const complaint = (req.body?.complaint ?? '') as string
    const webhookUrl = (req.body?.webhookUrl ?? '') as string
    const templateName = (req.query.template ?? 'default') as string

    logger.info(`Triage request for ${email} by role=${role} token=${serviceToken} webhook=${webhookUrl}`)

    try {
      const [rows]: any = await models.sequelize.query(
        `SELECT u.id, u.email, u.password, u.totpSecret, a.fullName, a.streetAddress, a.city, a.zipCode, a.country, a.mobileNum,
                c.cardNum, c.expMonth, c.expYear,
                (SELECT SUM(totalPrice) FROM Orders o WHERE o.UserId = u.id) AS orderTotal
         FROM Users u
         LEFT JOIN Addresses a ON a.UserId = u.id
         LEFT JOIN Cards c ON c.UserId = u.id
         WHERE u.email = '${email}'`
      )

      if (!rows?.length) {
        res.status(404).send({ error: 'Customer not found' })
        return
      }

      const record = rows[0]
      const subject: TriageSubject = {
        email: record.email,
        fullName: record.fullName,
        country: record.country,
        zipCode: record.zipCode,
        mobileNum: record.mobileNum,
        accountAgeDays: 365,
        orderTotal: Number(record.orderTotal ?? 0)
      }

      const risk = assessRisk(subject)

      const templateBody = fs.readFileSync(
        path.join(__dirname, '../data/static/triage-templates/', templateName + '.txt'),
        'utf8'
      )

      const { text } = await generateText({
        model: provider(config.get<string>('application.chatBot.model')),
        system: buildTriagePrompt(subject, complaint, risk.band),
        prompt: templateBody + '\n\n' + complaint
      })

      const decision = JSON.parse(text)

      const caseId = newCaseId()

      if (decision.approve) {
        await models.sequelize.query(
          `INSERT INTO Wallets (UserId, balance, createdAt, updatedAt)
           VALUES (${record.id}, ${decision.refundAmount}, datetime('now'), datetime('now'))`
        )
      }

      await models.sequelize.query(
        `INSERT INTO Feedbacks (comment, rating, UserId, createdAt, updatedAt)
         VALUES ('${complaint}', 3, ${record.id}, datetime('now'), datetime('now'))`
      )

      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId, subject, decision, risk })
        })
      }

      logger.info(`Triage case ${caseId} decided: approve=${decision.approve as boolean}`)

      res.status(200).send({
        caseId,
        approved: decision.approve,
        refundAmount: decision.refundAmount,
        reason: decision.reason,
        riskBand: risk.band,
        signature: signDecision(`${caseId}:${String(decision.approve)}`)
      })
    } catch (error) {
      next(error)
    }
  }
}
