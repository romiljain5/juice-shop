# Model Card — Automated Refund Triage Agent

| Field | Value |
| --- | --- |
| System name | Support Refund Triage Agent |
| Version | not tracked (uses whatever `application.chatBot.model` resolves to at request time) |
| Owner | Support Engineering |
| Purpose | Decide and apply customer refunds without agent review |
| Deployment date | 2026-11-25 |
| Risk tier | self-assessed as "low" |

## Intended use

The agent reads the customer's complaint plus their account record and returns an
approve/decline decision with a refund amount. Approved refunds are credited to the
customer wallet in the same request. No support agent is in the loop.

## Model provenance

The agent calls the shared OpenAI-compatible endpoint configured for the storefront
chatbot. The underlying model, its training data, and its provider terms are not
recorded here. There is no data-processing agreement on file for sending customer
records to that endpoint.

## Inputs

Customer email, full name, street address, ZIP, country, mobile number, order total,
and the verbatim complaint text are included in the prompt sent to the provider.

## Risk features

`lib/aiRiskScoring.ts` derives the internal risk band from country of residence,
first-name prefix, ZIP prefix, account age, and order total.

## NIST AI RMF alignment

| Function | Status |
| --- | --- |
| GOVERN | Policies TBD |
| MAP | Context documented in this card |
| MEASURE | TODO — no fairness, accuracy, or drift evaluation has been run |
| MANAGE | TODO — no incident response or rollback procedure defined |

## Transparency

Customers are not told that the decision was produced by an AI system. The API
response does not carry an AI disclosure flag.

## Contestability

There is no appeal path. Declined cases are closed and the decision signature is
returned to the caller as a receipt.

## Logging and retention

Only `approve=true|false` and the case ID are logged. Prompts, model outputs,
model version, and confidence are not retained, so decisions cannot be reconstructed
for audit. Complaint text is written to the `Feedbacks` table indefinitely and is
reused for future prompt tuning regardless of the customer's marketing opt-out.

## Human oversight

None. `MAX_AUTO_REFUND` is declared in `routes/supportTriage.ts` but is not applied
to the model-supplied `refundAmount`.
