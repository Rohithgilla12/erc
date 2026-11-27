import type { Metadata } from 'next'
import React from 'react'

import { requireCoach, run } from '@/members/run'

import { AnswerForm } from '../../../_feedback/feedback-forms'

import '../../members.css'
import '../../../_feedback/feedback.css'

export const metadata: Metadata = { title: 'Race questions', robots: { index: false, follow: false } }

const clubDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** Approved race questions for coaches to answer. Members who are not a linked club coach are sent back to /me. */
export default async function CoachQuestionsPage() {
  const caller = await requireCoach()
  const reply = await run('coachQuestions', caller, {})
  const items = reply.ok ? reply.data.items : []
  const open = items.filter((question) => question.answer === null).length

  return (
    <div className="page member-page">
      <header>
        <p>
          <a href="/me/coach">&larr; Back to your roster</a>
        </p>
        <h1>Race questions</h1>
        <p className="member-lede">
          Questions members asked on race pages, after a club volunteer approved them. Your answer shows on the race page with your name.{' '}
          {open === 0 ? 'Nothing is waiting for an answer.' : `${open} waiting for an answer.`}
        </p>
      </header>
      {reply.ok ? null : (
        <p className="member-alert" role="alert">
          {reply.error.message}
        </p>
      )}
      <ol className="feedback-list">
        {items.map((question) => (
          <li key={question.id} id={`question-${question.id}`} className="question">
            <p className="feedback-meta">
              <a href={`${question.race.path}#questions`}>{question.race.name}</a>
              <span>{clubDay.format(new Date(question.askedAt))}</span>
            </p>
            <p className="question-text">{question.text}</p>
            {question.answer !== null && !question.answeredByYou ? (
              <div className="answer">
                <p className="feedback-meta">Answered by staff or another coach</p>
                <p className="feedback-text">{question.answer}</p>
              </div>
            ) : (
              <AnswerForm question={question.id} answer={question.answer} />
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
