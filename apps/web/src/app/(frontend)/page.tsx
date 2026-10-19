import { DISCIPLINES } from '@erc/domain'
import React from 'react'

import './styles.css'

export default function HomePage() {
  return (
    <div className="home">
      <div className="content">
        <h1>ERC</h1>
        <p>Race calendar, training plans and stories for runners in Telangana and Andhra Pradesh.</p>
        <ul>
          {DISCIPLINES.map((discipline) => (
            <li key={discipline}>{discipline}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
