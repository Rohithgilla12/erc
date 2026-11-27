import { INTAKE_QUESTIONS, intakeAnswerText, type IntakeAnswers, type IntakeKey } from '@erc/domain'
import React from 'react'

function Rows({ answers, sensitive }: { answers: IntakeAnswers; sensitive: boolean }) {
  return (
    <dl className="intake-answers">
      {INTAKE_QUESTIONS.filter((q) => q.sensitive === sensitive).map((q) => {
        const text = intakeAnswerText(q.key, answers[q.key as IntakeKey])
        return (
          <div className="intake-answer" key={q.key}>
            <dt>{q.label}</dt>
            <dd>{text ?? <span className="intake-empty">Not answered</span>}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/** The answers as a reader sees them, health last under its own heading, in the registry's order. */
export function IntakeAnswersList({ answers }: { answers: IntakeAnswers }) {
  return (
    <>
      <h3 className="intake-answers-title">Running</h3>
      <Rows answers={answers} sensitive={false} />
      <h3 className="intake-answers-title">Health</h3>
      <Rows answers={answers} sensitive />
    </>
  )
}
