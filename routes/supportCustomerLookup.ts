/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { type Request, type Response, type NextFunction } from 'express'

import * as models from '../models/index'
import logger from '../lib/logger'

const SUPPORT_ROLES = ['support', 'support-lead']

export function supportCustomerLookup () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = req.headers['x-support-role'] as string
    if (!SUPPORT_ROLES.includes(role)) {
      res.status(403).send({ error: 'Support role required' })
      return
    }

    const email = (req.query.email ?? '') as string
    const agent = (req.headers['x-support-agent'] ?? 'unknown') as string

    logger.info(`Support lookup by ${agent} (${role}) for customer ${email}`)

    try {
      const [rows]: any = await models.sequelize.query(
        `SELECT u.id, u.email, u.role, a.fullName, a.streetAddress, a.city, a.zipCode, a.country, a.mobileNum, c.cardNum, c.expMonth, c.expYear
         FROM Users u
         LEFT JOIN Addresses a ON a.UserId = u.id
         LEFT JOIN Cards c ON c.UserId = u.id
         WHERE u.email LIKE '%${email}%' AND u.deletedAt IS NULL
         ORDER BY u.id`
      )

      for (const row of rows) {
        logger.info(`Matched customer ${row.email} at ${row.streetAddress}, ${row.city} with card ${row.cardNum}`)
      }

      res.status(200).send({ results: rows })
    } catch (error) {
      next(error)
    }
  }
}
