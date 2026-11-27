import type { MyReview } from '@erc/contract'
import type { Id, ReviewSubject } from '@erc/domain'
import React from 'react'

import { getQuestions, getReviews, type PublicAuthor, type RatingSummary } from '@/content/reviews'
import { deleteReviewAction } from '@/members/actions'
import { currentCaller, run, signInOpen, type Caller } from '@/members/run'

import { QuestionForm, ReviewForm } from './feedback-forms'

import '../me/members.css'
import './feedback.css'

const clubDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const dayOf = (instant: string) => clubDay.format(new Date(instant))

/** Filled marks for the rating, read out as words; the number beside them carries the meaning in print. */
export function Stars({ rating }: { rating: number }) {
  const whole = Math.round(rating)
  return (
    <span className="stars" role="img" aria-label={`${rating} out of 5`}>
      {'★'.repeat(whole)}
      <span className="stars-empty">{'★'.repeat(5 - whole)}</span>
    </span>
  )
}

export function RatingLine({ rating }: { rating: RatingSummary }) {
  if (rating.average === null) return <p className="rating-line">No reviews yet</p>
  return (
    <p className="rating-line">
      <strong className="rating-average">{rating.average.toFixed(1)}</strong>
      <Stars rating={rating.average} />
      <span>
        from {rating.count} {rating.count === 1 ? 'review' : 'reviews'}
      </span>
    </p>
  )
}

function Author({ author }: { author: PublicAuthor }) {
  return author.path ? <a href={author.path}>{author.name}</a> : <>{author.name}</>
}

function Paragraphs({ text }: { text: string }) {
  return text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)
}

function SignInPrompt({ to }: { to: string }) {
  return signInOpen() ? (
    <p className="feedback-prompt">
      <a href="/sign-in">Sign in</a> to {to}.
    </p>
  ) : (
    <p className="feedback-prompt">Club members {to} once signed in.</p>
  )
}

const MY_REVIEW_STATE: Record<MyReview['moderation']['state'], string> = {
  submitted: 'Your review is waiting for a club volunteer to check it.',
  approved: 'Your review is live. Changing it sends it back to be checked.',
  rejected: '',
}

const sameSubject = (review: MyReview, subject: ReviewSubject) => review.subject.kind === subject.kind && review.subject.id === subject.id

async function mineAbout(caller: Caller, subject: ReviewSubject) {
  if (caller.kind !== 'member') return { live: null, refused: null }
  const reply = await run('myReviews', caller, {})
  const items = reply.ok ? reply.data.items.filter((review) => sameSubject(review, subject)) : []
  return { live: items.find((review) => review.moderation.state !== 'rejected') ?? null, refused: items.find((review) => review.moderation.state === 'rejected') ?? null }
}

const draftOf = (review: MyReview | null): Record<string, string> =>
  review
    ? { rating: String(review.rating), title: review.title, body: review.body, kmRun: review.kmRun?.toString() ?? '', yearRun: review.yearRun?.toString() ?? '' }
    : {}

/** Approved reviews of a shoe or race, their average, and the signed-in member's own review to write or change. */
export async function ReviewsSection({ subject, path, noun }: { subject: ReviewSubject; path: string; noun: 'shoe' | 'race' }) {
  const [{ reviews, rating }, caller] = await Promise.all([getReviews(subject), currentCaller()])
  const mine = await mineAbout(caller, subject)
  return (
    <section id="reviews" className="feedback" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">Reviews</h2>
      <RatingLine rating={rating} />
      {reviews.length > 0 ? (
        <ol className="feedback-list">
          {reviews.map((review) => (
            <li key={review.id} className="review">
              <p className="review-rating">
                <Stars rating={review.rating} /> <span>{review.rating} / 5</span>
              </p>
              <h3>{review.title}</h3>
              <p className="feedback-meta">
                <Author author={review.author} />
                {review.kmRun !== null ? <span>{review.kmRun.toLocaleString('en-GB')} km in them</span> : null}
                {review.yearRun !== null ? <span>ran it in {review.yearRun}</span> : null}
                <span>{dayOf(review.at)}</span>
              </p>
              <div className="feedback-text">
                <Paragraphs text={review.body} />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="feedback-write">
        <h3>{mine.live ? 'Your review' : `Review this ${noun}`}</h3>
        {caller.kind === 'member' ? (
          <>
            {mine.live ? <p className="feedback-status">{MY_REVIEW_STATE[mine.live.moderation.state]}</p> : null}
            {!mine.live && mine.refused?.moderation.state === 'rejected' ? (
              <p className="feedback-status">
                Your earlier review was not published: {mine.refused.moderation.reason} You can write a new one.
              </p>
            ) : null}
            <ReviewForm subject={subject} review={mine.live?.id ?? null} initial={draftOf(mine.live)} />
            {mine.live ? (
              <form action={deleteReviewAction} className="feedback-delete">
                <input type="hidden" name="review" value={mine.live.id} />
                <input type="hidden" name="path" value={path} />
                <button className="button button-secondary" type="submit">
                  Delete my review
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <SignInPrompt to={`review this ${noun}`} />
        )}
      </div>
    </section>
  )
}

/** Approved questions about a race with their answers, and a form for signed-in members to ask. */
export async function QuestionsSection({ race }: { race: Id<'races'> }) {
  const [questions, caller] = await Promise.all([getQuestions(race), currentCaller()])
  return (
    <section id="questions" className="feedback" aria-labelledby="questions-heading">
      <h2 id="questions-heading">Questions</h2>
      {questions.length > 0 ? (
        <ol className="feedback-list">
          {questions.map((question) => (
            <li key={question.id} className="question">
              <p className="question-text">{question.text}</p>
              <p className="feedback-meta">
                <span>
                  Asked by <Author author={question.author} />
                </span>
                <span>{dayOf(question.at)}</span>
              </p>
              {question.answer ? (
                <div className="answer">
                  <p className="feedback-meta">
                    <span>
                      Answered by {question.answer.by ? <a href={question.answer.by.path}>{question.answer.by.name}</a> : 'the club'}
                    </span>
                    {question.answer.at ? <span>{dayOf(question.answer.at)}</span> : null}
                  </p>
                  <div className="feedback-text">
                    <Paragraphs text={question.answer.text} />
                  </div>
                </div>
              ) : (
                <p className="feedback-status">Not answered yet.</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="feedback-status">No questions yet.</p>
      )}
      <div className="feedback-write">
        <h3>Ask about this race</h3>
        {caller.kind === 'member' ? <QuestionForm race={race} /> : <SignInPrompt to="ask a question" />}
      </div>
    </section>
  )
}
