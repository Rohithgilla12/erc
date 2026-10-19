import { DISCIPLINES, disciplineLandingPath, stateLandingPath } from '@erc/domain'
import React from 'react'

import { DISCIPLINE_LABELS } from './races/_components/format'

export default function HomePage() {
  return (
    <div className="page home">
      <h1>ERC</h1>
      <p className="lede">Race calendar, training plans and stories for runners in Telangana and Andhra Pradesh.</p>
      <p>
        <a className="button" href="/races">
          See upcoming races
        </a>
      </p>
      <section>
        <h2>Races near you</h2>
        <ul className="link-list">
          <li>
            <a className="pill" href={stateLandingPath('IN-TS')}>
              Telangana
            </a>
          </li>
          <li>
            <a className="pill" href={stateLandingPath('IN-AP')}>
              Andhra Pradesh
            </a>
          </li>
        </ul>
      </section>
      <section>
        <h2>By discipline</h2>
        <ul className="link-list">
          {DISCIPLINES.map((discipline) => (
            <li key={discipline}>
              <a className="pill" href={disciplineLandingPath(discipline)}>
                {DISCIPLINE_LABELS[discipline]}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
