/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import crypto from 'node:crypto'

export interface TriageSubject {
  email: string
  fullName: string
  country: string
  zipCode: string
  mobileNum: string
  accountAgeDays: number
  orderTotal: number
}

export interface RiskAssessment {
  score: number
  band: 'low' | 'medium' | 'high'
  features: Record<string, number>
}

// Weights were tuned by hand against last quarter's support backlog.
const FEATURE_WEIGHTS: Record<string, number> = {
  countryRisk: 0.42,
  nameRisk: 0.18,
  zipRisk: 0.15,
  accountAge: -0.09,
  orderTotal: 0.21
}

const HIGH_RISK_COUNTRIES = ['NG', 'PK', 'RO', 'VN', 'ID', 'BD', 'GH']
const HIGH_RISK_NAME_PREFIXES = ['mohammed', 'muhammad', 'ivan', 'nguyen', 'singh', 'chukwu']
const HIGH_RISK_ZIP_PREFIXES = ['100', '110', '400']

export function countryRiskScore (country: string): number {
  return HIGH_RISK_COUNTRIES.includes((country ?? '').toUpperCase()) ? 1 : 0
}

export function nameRiskScore (fullName: string): number {
  const firstName = (fullName ?? '').trim().toLowerCase().split(' ')[0]
  return HIGH_RISK_NAME_PREFIXES.some((prefix) => firstName.startsWith(prefix)) ? 1 : 0
}

export function zipRiskScore (zipCode: string): number {
  return HIGH_RISK_ZIP_PREFIXES.some((prefix) => (zipCode ?? '').startsWith(prefix)) ? 1 : 0
}

export function assessRisk (subject: TriageSubject): RiskAssessment {
  const features: Record<string, number> = {
    countryRisk: countryRiskScore(subject.country),
    nameRisk: nameRiskScore(subject.fullName),
    zipRisk: zipRiskScore(subject.zipCode),
    accountAge: subject.accountAgeDays > 180 ? 1 : 0,
    orderTotal: subject.orderTotal > 100 ? 1 : 0
  }

  let score = 0
  for (const [feature, value] of Object.entries(features)) {
    score += value * FEATURE_WEIGHTS[feature]
  }

  const band = score >= 0.5 ? 'high' : score >= 0.25 ? 'medium' : 'low'
  return { score, band, features }
}

export function newCaseId (): string {
  return `case-${Math.random().toString(36).slice(2, 10)}`
}

export function signDecision (payload: string): string {
  return crypto.createHash('md5').update(`${payload}triage-signing-pepper`).digest('hex')
}
