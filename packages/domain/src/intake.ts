import { collect, firstOf, type FieldErrors, type FieldResult } from './form-fields'
import { MIN_MEMBER_AGE, type RawInput } from './members'
import { err, ok, type LocalDate, type Result, type Seconds } from './primitives'

type Option = { readonly value: string; readonly label: string }

type QuestionBase = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  /** Health answers. The form and the coach view group them under their own heading. */
  readonly sensitive: boolean
  readonly help?: string
}

export type IntakeQuestion = QuestionBase &
  (
    | { readonly kind: 'choice'; readonly options: readonly Option[] }
    | { readonly kind: 'number'; readonly integer: boolean; readonly unit?: string; readonly range: (today: LocalDate) => readonly [number, number] }
    | { readonly kind: 'time'; readonly range: readonly [Seconds, Seconds] }
    | { readonly kind: 'text'; readonly maxLength: number; readonly multiline: boolean }
  )

export type IntakeKind = IntakeQuestion['kind']

const minutes = (m: number) => (m * 60) as Seconds

/**
 * Every intake question, in the order the form asks them. The form, the parser, and the coach view all walk this
 * list, so a new question is one entry here. Changing or removing a key strands the answers already stored under it,
 * which then fail to parse on read and ask the member to take the intake again.
 */
export const INTAKE_QUESTIONS = [
  {
    key: 'birthYear',
    label: 'Year of birth',
    kind: 'number',
    integer: true,
    required: true,
    sensitive: false,
    range: (today: LocalDate) => [1920, Number(today.slice(0, 4)) - MIN_MEMBER_AGE] as const,
  },
  {
    key: 'goal',
    label: 'Main goal',
    kind: 'choice',
    required: true,
    sensitive: false,
    options: [
      { value: 'start', label: 'Start running regularly' },
      { value: 'first_race', label: 'Finish my first race' },
      { value: 'faster', label: 'Run faster' },
      { value: 'longer', label: 'Run further' },
      { value: 'health', label: 'Health and fitness' },
    ],
  },
  { key: 'goalDetail', label: 'Your goal in your own words', kind: 'text', maxLength: 280, multiline: true, required: false, sensitive: false, help: 'A race, a time, or a habit you want.' },
  { key: 'weeklyKm', label: 'Weekly running volume', kind: 'number', integer: false, unit: 'km', required: true, sensitive: false, range: () => [0, 300] as const, help: 'A typical week lately. Enter 0 if you are not running yet.' },
  { key: 'recent5k', label: 'Recent 5K time', kind: 'time', range: [minutes(12), minutes(120)], required: false, sensitive: false, help: 'Minutes and seconds, such as 28:45. Leave empty if you have not run one.' },
  { key: 'recent10k', label: 'Recent 10K time', kind: 'time', range: [minutes(25), minutes(240)], required: false, sensitive: false, help: 'Such as 58:30 or 1:04:10.' },
  { key: 'eventsLastYear', label: 'Events run in the last year', kind: 'text', maxLength: 500, multiline: true, required: false, sensitive: false, help: 'Race names and distances, one per line.' },
  { key: 'sleepHours', label: 'Typical sleep a night', kind: 'number', integer: false, unit: 'hours', required: true, sensitive: false, range: () => [2, 14] as const },
  {
    key: 'sleepQuality',
    label: 'Sleep quality',
    kind: 'choice',
    required: true,
    sensitive: false,
    options: [
      { value: 'good', label: 'Good, I wake rested' },
      { value: 'fair', label: 'Fair' },
      { value: 'poor', label: 'Poor, often tired' },
    ],
  },
  {
    key: 'nutrition',
    label: 'Eating habits',
    kind: 'choice',
    required: true,
    sensitive: false,
    options: [
      { value: 'regular', label: 'Regular, balanced meals' },
      { value: 'irregular', label: 'Irregular meals or long gaps' },
      { value: 'restricted', label: 'A restricted or special diet' },
    ],
  },
  { key: 'nutritionNotes', label: 'Anything else about how you eat', kind: 'text', maxLength: 280, multiline: true, required: false, sensitive: false },
  {
    key: 'healthCondition',
    label: 'Heart or other health conditions',
    kind: 'choice',
    required: true,
    sensitive: true,
    options: [
      { value: 'none', label: 'None that I know of' },
      { value: 'cardiovascular', label: 'A heart or blood pressure condition' },
      { value: 'other', label: 'Another condition' },
      { value: 'undisclosed', label: 'I would rather not say' },
    ],
  },
  { key: 'healthNotes', label: 'About the condition', kind: 'text', maxLength: 500, multiline: true, required: false, sensitive: true, help: 'Only if you want your coach to know more.' },
  { key: 'injuries', label: 'Current injuries or pain', kind: 'text', maxLength: 500, multiline: true, required: false, sensitive: true, help: 'Leave empty if none.' },
  { key: 'medications', label: 'Regular medication', kind: 'text', maxLength: 500, multiline: true, required: false, sensitive: true, help: 'Optional. Leave empty if none, or if you would rather not say.' },
] as const satisfies readonly IntakeQuestion[]

type Spec = (typeof INTAKE_QUESTIONS)[number]
export type IntakeKey = Spec['key']

type ValueOf<Q extends Spec> = Q extends { kind: 'choice'; options: readonly (infer O)[] }
  ? O extends { value: infer V } ? V : never
  : Q extends { kind: 'number' } ? number
    : Q extends { kind: 'time' } ? Seconds
      : string

/** One value per question: a required answer is always present, an optional one is null when left empty. */
export type IntakeAnswers = { readonly [Q in Spec as Q['key']]: Q['required'] extends true ? ValueOf<Q> : ValueOf<Q> | null }

export const INTAKE_KEYS: readonly IntakeKey[] = INTAKE_QUESTIONS.map((q) => q.key)

const TIME = /^(?:(\d):([0-5]\d)|(\d{1,3})):([0-5]\d)$/

/** `mm:ss` with minutes past 59 allowed, as runners write a 10K, or `h:mm:ss`. */
export const parseRaceTime = (raw: string): Seconds | null => {
  const match = TIME.exec(raw)
  if (!match) return null
  const [, hours, hourMinutes, plainMinutes, seconds] = match
  return (Number(hours ?? 0) * 3600 + Number(hourMinutes ?? plainMinutes) * 60 + Number(seconds)) as Seconds
}

export const formatRaceTime = (total: Seconds): string => {
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// A JSON client may send numbers as numbers, and stored answers carry times as seconds.
const textOf = (raw: unknown): string => (typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : firstOf(raw))

const NUMBER = /^\d{1,4}(?:\.\d{1,2})?$/

const parseAnswer = (question: IntakeQuestion, raw: unknown, today: LocalDate): FieldResult<unknown> => {
  const text = textOf(raw)
  if (text === '') return question.required ? err('Answer this question.') : ok(null)
  switch (question.kind) {
    case 'choice':
      return question.options.some((option) => option.value === text) ? ok(text) : err('Choose one of the options.')
    case 'number': {
      const [low, high] = question.range(today)
      const value = Number(text.replace(',', '.'))
      const valid = NUMBER.test(text.replace(',', '.')) && (!question.integer || Number.isInteger(value)) && value >= low && value <= high
      return valid ? ok(value) : err(`Enter a ${question.integer ? 'whole number' : 'number'} from ${low} to ${high}.`)
    }
    case 'time': {
      const seconds = typeof raw === 'number' && Number.isInteger(raw) ? (raw as Seconds) : parseRaceTime(text)
      const [low, high] = question.range
      if (seconds === null) return err('Enter the time as minutes:seconds, such as 28:45, or hours:minutes:seconds.')
      return seconds >= low && seconds <= high ? ok(seconds) : err(`Enter a time from ${formatRaceTime(low)} to ${formatRaceTime(high)}.`)
    }
    case 'text':
      return Array.from(text).length <= question.maxLength ? ok(text) : err(`Keep this under ${question.maxLength} characters.`)
  }
}

/**
 * Every question's answer, or an error per field. A key that names no question is refused, so a client cannot store
 * something the club never asked for. Times arrive as text or, from stored answers, as seconds.
 */
export const parseIntakeAnswers = (raw: unknown, today: LocalDate): Result<IntakeAnswers, FieldErrors> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return err({ answers: 'Send the answers as an object.' })
  const fields = raw as RawInput
  const strays = Object.keys(fields).filter((key) => !(INTAKE_KEYS as readonly string[]).includes(key))
  const parsed = collect(Object.fromEntries(INTAKE_QUESTIONS.map((q) => [q.key, parseAnswer(q, fields[q.key], today)])))
  if (strays.length === 0) return parsed as Result<IntakeAnswers, FieldErrors>
  return err({ ...(parsed.ok ? {} : parsed.error), ...Object.fromEntries(strays.map((key) => [key, 'This is not an intake question.'])) })
}

export type IntakeSubmission = { answers: IntakeAnswers; shareWithCoach: boolean }

const yes = (raw: unknown) => raw === true || ['on', 'true', 'yes'].includes(firstOf(raw))

/** A save needs consent every time: it is what `consented_at` records. */
export const parseIntakeSubmission = (raw: RawInput, today: LocalDate): Result<IntakeSubmission, FieldErrors> => {
  const answers = parseIntakeAnswers(raw.answers, today)
  const consent = yes(raw.consent) ? null : { consent: 'Tick the box to let ERC store your answers.' }
  if (!answers.ok || consent) return err({ ...(answers.ok ? {} : answers.error), ...consent })
  return ok({ answers: answers.value, shareWithCoach: yes(raw.shareWithCoach) })
}

const questionOf = (key: IntakeKey): IntakeQuestion => INTAKE_QUESTIONS.find((q) => q.key === key) as IntakeQuestion

/** The answer as the form field holds it, for showing a saved intake again. */
export const intakeFieldValue = (key: IntakeKey, value: IntakeAnswers[IntakeKey]): string => {
  if (value === null) return ''
  return questionOf(key).kind === 'time' ? formatRaceTime(value as Seconds) : String(value)
}

/** The answer as a reader sees it: a choice by its label, a number with its unit. Null when left empty. */
export const intakeAnswerText = (key: IntakeKey, value: IntakeAnswers[IntakeKey]): string | null => {
  if (value === null) return null
  const question = questionOf(key)
  switch (question.kind) {
    case 'choice':
      return question.options.find((option) => option.value === value)?.label ?? String(value)
    case 'number':
      return question.unit ? `${value} ${question.unit}` : String(value)
    case 'time':
      return formatRaceTime(value as Seconds)
    case 'text':
      return String(value)
  }
}
