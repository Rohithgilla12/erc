import { CONFIRM_LIMIT_WINDOW_MS, CONFIRM_LINK_TTL_MS, MIN_MEMBER_AGE, SESSION_IDLE_DAYS, SIGN_IN_CODE_TTL_MS } from '@erc/domain'
import type { Metadata } from 'next'
import React from 'react'

import { UNCONFIRMED_KEPT_MS } from '@/content/newsletter'

import { CLUB, PRIVACY_NOTICE } from '../site-nav'

const DESCRIPTION = `What personal data ${CLUB.name} collects through this website, why, how long we keep it, who handles it for us, and how to see, correct, or erase it.`

export const metadata: Metadata = {
  title: 'Privacy notice',
  description: DESCRIPTION,
  alternates: { canonical: PRIVACY_NOTICE.href },
}

const HOUR_MS = 60 * 60 * 1000
const days = (ms: number) => `${ms / (24 * HOUR_MS)} days`
const hours = (ms: number) => `${ms / HOUR_MS} hours`

const updated = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(PRIVACY_NOTICE.updated))

/** The notice under section 5 of India's Digital Personal Data Protection Act, 2023. Keep it in step with the code it describes. */
export default function PrivacyPage() {
  return (
    <div className="page">
      <article className="prose">
        <h1>Privacy notice</h1>
        <p>
          This notice explains what personal data {CLUB.name} collects through this website, why we collect it, how long we keep
          it, who handles it for us, and how you can ask us to see, correct, or erase it. It is our notice under section 5 of
          India&apos;s Digital Personal Data Protection Act, 2023.
        </p>
        <p>
          Last updated <time dateTime={PRIVACY_NOTICE.updated}>{updated}</time>.
        </p>

        <h2>Who we are</h2>
        <p>
          {CLUB.name} runs this website and decides how the data below is used. To reach us about your data, use our{' '}
          <a href="/contact">contact page</a>.
        </p>

        <h2>What we collect and why</h2>
        <h3>Newsletter signups</h3>
        <p>
          We store your email address, when you asked to join, and when you confirmed. We use it only to send the club newsletter,
          and only after you confirm through the link we email you. We also store when we sent you the last two confirmation
          emails, so that nobody can use the form to email you again and again.
        </p>
        <h3>Messages through the contact form</h3>
        <p>
          We store your name, email address, phone number if you give one, the topic, your message, and your permission for us to
          reply. We use them to answer you.
        </p>
        <h3>Athlete profiles</h3>
        <p>
          Our coaches add profiles for club athletes, with the athlete&apos;s agreement: name, photo, a short bio, city and state,
          the year they started running, and race results and personal bests. A profile and its results stay hidden until the
          athlete agrees to show them, and the athlete decides for each one. A photo is added only once the athlete agrees, and an
          uploaded photo can be opened by anyone who has its web address.
        </p>
        <h3>Member accounts</h3>
        <p>
          If you sign in, we store your email address, when you confirmed you are {MIN_MEMBER_AGE} or over, and when you last
          signed in. Each sign-in emails you a code; we store only a keyed hash of it for {SIGN_IN_CODE_TTL_MS / 60_000} minutes. We
          store a hash of each signed-in device&apos;s session, which lasts {SESSION_IDLE_DAYS} days from its last use, and the
          runs you log: date, distance, and time. Your runs are shown only to you.
        </p>
        <h3>Keeping the forms safe</h3>
        <p>
          To limit how often one connection can send the forms, we store a keyed hash of the network each form was sent from, with
          the signup or message. We never store your IP address itself.
        </p>
        <h3>Visit statistics</h3>
        <p>
          We count visits with Umami, which we run on our own server. It sets no cookies and does not store your IP address. It
          records the page address without anything after a question mark, the site that linked you here, your browser, operating
          system, device type, screen size, language, and an approximate location such as your country, worked out from your
          connection. If your browser sends a Do Not Track signal, your visit is not counted.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>
            A newsletter signup that is never confirmed is deleted {days(UNCONFIRMED_KEPT_MS)} after you asked to join. The
            confirmation link itself stops working after {hours(CONFIRM_LINK_TTL_MS)}.
          </li>
          <li>
            When you unsubscribe, we stop emailing you at once. We delete your address within the hour once{' '}
            {hours(CONFIRM_LIMIT_WINDOW_MS)} have passed since the last confirmation email we sent you.
          </li>
          <li>A confirmed address stays on the list until you unsubscribe or ask us to erase it.</li>
          <li>
            Messages from the contact form stay in our admin so we can follow up, until a member of staff deletes them. Ask us and
            we will delete yours.
          </li>
          <li>An athlete profile stays until the athlete asks us to remove it. Removing a profile deletes its results too.</li>
          <li>
            A member account and its runs stay until you ask us to erase them. A sign-in code is deleted a day after it was
            sent, and a session once it has not been used for {SESSION_IDLE_DAYS} days.
          </li>
          <li>
            Visit statistics are kept on our server with no set deletion date. They are not linked to your name or email address.
          </li>
        </ul>

        <h2>Who handles it for us</h2>
        <ul>
          <li>
            <strong>Our own server.</strong> The website, its database, and the visit statistics run on a server the club manages
            itself.
          </li>
          <li>
            <strong>Cloudflare.</strong> Every visit to the site passes through Cloudflare, which protects the site and connects it
            to our server. Cloudflare sees your IP address and the pages your browser asks for.
          </li>
          <li>
            <strong>Google (Gmail).</strong> Once the club sends email from the site, newsletter confirmation emails, sign-in
            codes, and our notices of new contact form messages go out through the club&apos;s Gmail account, so Google handles
            the address and the content of each email.
          </li>
          <li>
            <strong>Cloudflare R2.</strong> Photos and files uploaded to the site, including athlete photos, are stored in
            Cloudflare&apos;s R2 storage.
          </li>
        </ul>
        <p>We do not sell your data, and we do not share it with advertisers.</p>

        <h2>Your rights</h2>
        <p>You can ask us to:</p>
        <ul>
          <li>tell you what personal data we hold about you and how we use it</li>
          <li>correct it, complete it, or bring it up to date</li>
          <li>erase it</li>
          <li>stop using it where you gave your consent, which you can withdraw as easily as you gave it</li>
        </ul>
        <p>
          Send your request through our <a href="/contact">contact page</a>, and tell us which email address or profile it is
          about. We may ask you to show that the data is yours before we act. To stop the newsletter, use the unsubscribe link in
          any email from us. You can name someone to act for you if you cannot. If you are not satisfied with our answer, you can
          complain to the Data Protection Board of India.
        </p>

        <h2>Changes to this notice</h2>
        <p>When we change this notice, we update the date at the top of this page.</p>
      </article>
    </div>
  )
}
