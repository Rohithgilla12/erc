import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

import { CLUB } from '@/app/(frontend)/site-nav'

const UI = ({ children }: { children: React.ReactNode }) => <span className="ui">{children}</span>

export function Handbook({ className }: { className: string }) {
  return (
    <div className={`erc-handbook ${className}`}>
      <header className="bib" aria-labelledby="hb-title">
        <span className="pins" aria-hidden="true" />
        <Image src="/brand/erc-mark.png" alt={`${CLUB.name} logo`} width={128} height={128} unoptimized />
        <div className="bib-text">
          <span className="eyebrow">{CLUB.name}</span>
          <h1 id="hb-title">Admin handbook</h1>
          <p>For the coaches and editors who keep the website up to date: articles, videos, races, training plans, and athlete results.</p>
        </div>
        <div className="bib-foot">
          <Link className="address" href="/" prefetch={false}>
            View the website
          </Link>
          <span>Everything you publish appears on the site straight away.</span>
        </div>
      </header>

      <section aria-labelledby="hb-account">
        <span className="eyebrow">Before you start</span>
        <h2 id="hb-account">Your account</h2>
        <ul>
          <li>Only an admin can create accounts. If a new coach needs one, ask an admin.</li>
          <li>Password reset emails are not switched on yet. If you forget your password, ask an admin to set a new one.</li>
          <li>Keep your password in a password manager, not in a chat or a note.</li>
          <li>
            Come back to this page any time from <strong>Handbook</strong> in the left-hand menu.
          </li>
        </ul>
      </section>

      <section aria-labelledby="hb-roles">
        <span className="eyebrow">Who can do what</span>
        <h2 id="hb-roles">Three roles</h2>
        <p className="lede">
          Your role decides which buttons you see. Most coaches are authors. One or two people who check work before it goes out are
          editors.
        </p>
        <div className="roles">
          <article className="role">
            <span className="tag">Author</span>
            <ul>
              <li>Write and edit drafts of articles, videos, plans, downloads, coach profiles, and pages.</li>
              <li>Submit a draft for review.</li>
              <li>Add races, athletes, and results for an editor to approve.</li>
            </ul>
          </article>
          <article className="role is-editor">
            <span className="tag">Editor</span>
            <ul>
              <li>Everything an author can do.</li>
              <li>Publish and unpublish.</li>
              <li>Send work back with a note saying what to change.</li>
              <li>Approve or reject races, athletes, and results.</li>
            </ul>
          </article>
          <article className="role is-admin">
            <span className="tag">Admin</span>
            <ul>
              <li>Everything an editor can do.</li>
              <li>Create staff accounts and change roles.</li>
            </ul>
          </article>
        </div>
      </section>

      <section aria-labelledby="hb-map">
        <span className="eyebrow">Finding your way</span>
        <h2 id="hb-map">Two groups in the menu</h2>
        <p>The left-hand menu has two groups, and they work differently. On a narrow screen, open the menu with the button at the top left.</p>
        <ul>
          <li>
            <strong>Content</strong> holds what you write: posts, videos, pages, topics, coaches, training plans, and downloads. These go
            through draft, review, and publish.
          </li>
          <li>
            <strong>Records</strong> holds facts about the world: races, athletes, and results, plus enquiries, newsletter subscribers,
            uploaded media, and staff accounts. Races, athletes, and results need an editor&rsquo;s approval before they appear.
          </li>
        </ul>
      </section>

      <section aria-labelledby="hb-publish">
        <span className="eyebrow">Content</span>
        <h2 id="hb-publish">Writing and publishing</h2>

        <div className="figure" role="group" aria-label="How a piece of content goes from draft to live">
          <div className="track">
            <div className="stop">
              <span className="state">Draft</span>
              <p>
                Write, then click <UI>Save Draft</UI>. Only staff can see it.
              </p>
              <span className="who">Author</span>
            </div>
            <div className="leg">Submit for review</div>
            <div className="stop">
              <span className="state">In review</span>
              <p>Waiting for an editor to read it.</p>
              <span className="who">Editor</span>
            </div>
            <div className="leg">Publish</div>
            <div className="stop is-live">
              <span className="state">Live</span>
              <p>On the website for everyone.</p>
              <span className="who">Public</span>
            </div>
          </div>
          <div className="return">
            <span>
              An editor can choose <strong>Request changes</strong> with a note instead. The author fixes it and submits again.
            </span>
          </div>
        </div>

        <div
          className="mock"
          role="img"
          aria-label="Sketch of the editing screen. The Save Draft and Publish changes buttons are at the top right. The Review dropdown is in the right-hand sidebar."
        >
          <div className="mock-bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>/admin/collections/posts/12</span>
          </div>
          <div className="mock-body" aria-hidden="true">
            <div className="mock-nav">
              <b>Records</b>
              <span>Staff</span>
              <span>Media</span>
              <span>Races</span>
              <span>Athletes</span>
              <span>Results</span>
              <b>Content</b>
              <span>Coaches</span>
              <span>Topics</span>
              <span className="on">Posts</span>
              <span>Videos</span>
              <span>Pages</span>
            </div>
            <div className="mock-main">
              <div className="mock-head">
                <span className="mock-title">Easy runs: why slow builds fast</span>
                <div className="btns">
                  <span className="btn hl">
                    Save Draft<span className="num">1</span>
                  </span>
                  <span className="btn primary hl">
                    Publish changes<span className="num">3</span>
                  </span>
                </div>
              </div>
              <span className="field-label">Title</span>
              <div className="line" style={{ width: '70%' }} />
              <span className="field-label">Excerpt</span>
              <div className="line" />
              <div className="line" style={{ width: '55%' }} />
              <span className="field-label">Body</span>
              <div className="box">
                <div className="line" />
                <div className="line" />
                <div className="line" style={{ width: '80%' }} />
                <div className="line" style={{ width: '62%' }} />
              </div>
            </div>
            <div className="mock-side">
              <div>
                <span className="field-label">Slug</span>
                <div className="select plain">easy-runs-why-slow-builds-fast</div>
              </div>
              <div>
                <span className="field-label">Topics</span>
                <div className="select">Easy running</div>
              </div>
              <div className="hl">
                <span className="field-label">Review</span>
                <div className="select">Submit for review</div>
                <span className="num">2</span>
              </div>
              <div>
                <span className="field-label">Workflow</span>
                <div className="box">
                  <div className="line" />
                  <div className="line" style={{ width: '60%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <ol className="legend">
          <li>
            <span className="num">1</span>
            <span>
              <UI>Save Draft</UI> keeps your work without publishing it. Save as often as you like.
            </span>
          </li>
          <li>
            <span className="num">2</span>
            <span>
              The <strong>Review</strong> dropdown is in the right-hand sidebar. Choose <em>Submit for review</em>, then click{' '}
              <UI>Save Draft</UI>. Editors also see <em>Request changes</em> here, with a box for the note.
            </span>
          </li>
          <li>
            <span className="num">3</span>
            <span>
              Only editors and admins see <UI>Publish</UI>. On something already live it reads <UI>Publish changes</UI>.{' '}
              <UI>Unpublish</UI> takes it off the site again.
            </span>
          </li>
        </ol>

        <h3>Editing something that is already live</h3>
        <p>
          The live version stays on the site while you work. Your edits are a pending draft until an editor publishes them, so a
          half-finished edit never appears in public. An editor&rsquo;s note asking for changes shows in the <strong>Workflow</strong> box
          in the sidebar.
        </p>
        <p>The admin does not send email alerts yet. When you submit something, tell an editor in the club chat.</p>
      </section>

      <section aria-labelledby="hb-approve">
        <span className="eyebrow">Records</span>
        <h2 id="hb-approve">Approving races, athletes, and results</h2>

        <div className="figure" role="group" aria-label="How a race, athlete, or result is approved">
          <div className="track two">
            <div className="stop">
              <span className="state">Submitted</span>
              <p>Every new race, athlete, or result starts here. Only staff can see it.</p>
              <span className="who">Anyone on staff</span>
            </div>
            <div className="leg">Editor decides</div>
            <div className="branches">
              <div className="stop is-live">
                <span className="state">Approved</span>
                <p>Shows on the site.</p>
              </div>
              <div className="stop is-off">
                <span className="state">Rejected</span>
                <p>Stays hidden, with the reason recorded.</p>
              </div>
            </div>
          </div>
        </div>

        <ul>
          <li>
            An editor opens the record, sets <strong>Decision</strong> in the sidebar to <em>Approve</em>, or to <em>Reject</em> with a
            reason, then saves.
          </li>
          <li>A decision is final. To change your mind, edit the record or delete it.</li>
          <li>
            <strong>Edits to an approved record go live as soon as anyone saves.</strong> There is no review step for edits, so take care
            with approved races and results.
          </li>
        </ul>
      </section>

      <section aria-labelledby="hb-where">
        <span className="eyebrow">Admin to website</span>
        <h2 id="hb-where">Where things appear</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">In the admin</th>
                <th scope="col">On the website</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Pages <span className="grp">Content</span>
                </td>
                <td>
                  The home, About, Coaching, and Contact pages. Only the slugs <code>home</code>, <code>about</code>, <code>coaching</code>,
                  and <code>contact</code> show up. Until one is published, the site shows built-in text with the club description.
                </td>
              </tr>
              <tr>
                <td>
                  Posts and Topics <span className="grp">Content</span>
                </td>
                <td>
                  <code>/learn</code>. Every post needs at least one topic and one coach as author.
                </td>
              </tr>
              <tr>
                <td>
                  Videos <span className="grp">Content</span>
                </td>
                <td>
                  <code>/videos</code>. The video stays on YouTube; the site shows it with your transcript.
                </td>
              </tr>
              <tr>
                <td>
                  Coaches <span className="grp">Content</span>
                </td>
                <td>Article bylines, plan credits, and the coach grid on the Coaching page.</td>
              </tr>
              <tr>
                <td>
                  Training plans and Downloads <span className="grp">Content</span>
                </td>
                <td>
                  <code>/plans</code>, with a printable week-by-week view.
                </td>
              </tr>
              <tr>
                <td>
                  Races <span className="grp">Records</span>
                </td>
                <td>
                  <code>/races</code>, with state and discipline pages and a calendar download for each race.
                </td>
              </tr>
              <tr>
                <td>
                  Athletes and Results <span className="grp">Records</span>
                </td>
                <td>
                  <code>/athletes</code>. A profile shows only when it is approved and the athlete has agreed to make it public.
                </td>
              </tr>
              <tr>
                <td>
                  Enquiries <span className="grp">Records</span>
                </td>
                <td>Not public. Messages sent through the contact form.</td>
              </tr>
              <tr>
                <td>
                  Subscribers <span className="grp">Records</span>
                </td>
                <td>Not public. Newsletter signups, once email is switched on.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="hb-recipes">
        <span className="eyebrow">Step by step</span>
        <h2 id="hb-recipes">Common jobs</h2>
        <div className="recipes">
          <article className="recipe">
            <h3>Write an article</h3>
            <span className="meta">Content, then Posts, then Create New</span>
            <ol>
              <li>Add the title, a one or two sentence excerpt, and the body. Add a cover image if you have one.</li>
              <li>In the sidebar, pick at least one topic and at least one coach as author. The topic must already be published.</li>
              <li>
                For claims backed by research, list the sources under <strong>References</strong>. They appear under the article.
              </li>
              <li>Save the draft, then submit it for review.</li>
            </ol>
          </article>

          <article className="recipe">
            <h3>Add a race</h3>
            <span className="meta">Records, then Races, then Create New</span>
            <ol>
              <li>
                Enter the name, discipline, and start date. For a race at a venue, add the venue, city, and state. Choose{' '}
                <strong>Virtual</strong> for a race run anywhere.
              </li>
              <li>
                Add each distance in metres, such as 21097 for a half marathon. Add elevation gain and cutoff if the organiser publishes
                them.
              </li>
              <li>
                Paste the official race website and the registration page. Both must start with <code>https://</code>.
              </li>
              <li>
                Under <strong>Source</strong>, say where the details came from: the organiser, a listing site, a runner, or coach
                knowledge. For coach knowledge, pick yourself as the coach who confirmed them. Set <strong>Last verified on</strong> to
                today.
              </li>
              <li>
                Write a short summary and save. An editor approves it before it shows on <code>/races</code>.
              </li>
            </ol>
          </article>

          <article className="recipe">
            <h3>Build a training plan</h3>
            <span className="meta">Content, then Training plans, then Create New</span>
            <ol>
              <li>Choose the goal distance and level. Say what a runner should already manage, and who the plan is for.</li>
              <li>Add one week at a time. Each week has a one-line focus, such as &ldquo;Build to 20 minutes of running&rdquo;.</li>
              <li>Add sessions to each week. Pick the day and intensity, then measure each session by time or by distance.</li>
              <li>
                Add strength and recovery guidance if you have it, credit the coaches, then submit for review. The plan length is the
                number of weeks you add.
              </li>
            </ol>
          </article>

          <article className="recipe">
            <h3>Add an athlete and their results</h3>
            <span className="meta">Records, then Athletes, then Results</span>
            <ol>
              <li>
                Create the athlete with their name, a slug such as <code>priya-reddy</code>, and their home state. Leave both visibility
                choices hidden until the athlete tells you they agree to share.
              </li>
              <li>
                Add a photo only once they agree. An uploaded image can be opened by anyone who has its address, even while the profile
                is hidden.
              </li>
              <li>
                Add each result with the event, distance in metres, and finish time as <code>h:mm:ss</code>, such as <code>1:52:30</code>
                . Pick the race from the calendar if it is there.
              </li>
              <li>
                Each result starts as <strong>Official race result</strong>. Keep that only when the organiser published it, and add the
                timing link. Otherwise switch to <strong>Self-reported</strong>. Only official results show as Verified on the site.
              </li>
              <li>An editor approves the athlete and each result.</li>
            </ol>
          </article>

          <article className="recipe">
            <h3>Change the home page</h3>
            <span className="meta">Content, then Pages</span>
            <ol>
              <li>
                Open the page with the slug <code>home</code>, or create it with that slug if it does not exist yet.
              </li>
              <li>
                The page is a stack of blocks: hero, text, upcoming races, latest articles, featured plans, call to action, coach grid,
                and FAQ. Add, reorder, or remove blocks in the editor.
              </li>
              <li>
                The upcoming races and latest articles blocks fill themselves from approved races and published posts. You only choose
                how many to show.
              </li>
              <li>Save the draft and submit it, or publish it if you are an editor.</li>
            </ol>
          </article>
        </div>
      </section>

      <section aria-labelledby="hb-habits">
        <span className="eyebrow">Good habits</span>
        <h2 id="hb-habits">Worth knowing</h2>
        <div className="habits">
          <div className="habit">
            <b>Choose the slug once</b>
            <p>
              The slug in the sidebar is the page address. Leave it empty and it is made from the title. Changing it later breaks links
              people have shared.
            </p>
          </div>
          <div className="habit">
            <b>Ask before adding photos of people</b>
            <p>Uploaded files can be opened by anyone with the link, whether or not the page that uses them is public.</p>
          </div>
          <div className="habit">
            <b>Leave &ldquo;Search and sharing&rdquo; empty</b>
            <p>
              Fill it in only when you want a different title or description in Google or on WhatsApp previews. Empty fields use the
              title and excerpt.
            </p>
          </div>
          <div className="habit">
            <b>Mark enquiries handled</b>
            <p>Contact form messages land in Enquiries. Mark each one handled once someone has replied, so nobody answers twice.</p>
          </div>
          <div className="habit">
            <b>Deleting is for drafts</b>
            <p>Authors can delete only what is not live. Editors can delete anything, which removes it from the site at once.</p>
          </div>
          <div className="habit">
            <b>Staff who approved races stay</b>
            <p>An admin cannot delete a staff account that confirmed or approved races. Reassign those races first.</p>
          </div>
        </div>
      </section>

      <footer>
        <span className="motto">{CLUB.motto}</span>
        <span>{CLUB.name}</span>
      </footer>
    </div>
  )
}
