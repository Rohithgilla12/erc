import * as migration_20261019_113052_initial from './20261019_113052_initial';
import * as migration_20261019_114743_race_source_confirmed_by from './20261019_114743_race_source_confirmed_by';
import * as migration_20261019_122421_editorial_live_and_revision from './20261019_122421_editorial_live_and_revision';
import * as migration_20261019_123018_race_moderation_submitter from './20261019_123018_race_moderation_submitter';
import * as migration_20261019_153553_athletes_results from './20261019_153553_athletes_results';
import * as migration_20261019_153928_learning_centre from './20261019_153928_learning_centre';
import * as migration_20261019_154509_pages_and_enquiries from './20261019_154509_pages_and_enquiries';
import * as migration_20261020_024631_plans_and_resources from './20261020_024631_plans_and_resources';
import * as migration_20261020_032538_newsletter_subscribers from './20261020_032538_newsletter_subscribers';
import * as migration_20261020_033438_home_blocks from './20261020_033438_home_blocks';
import * as migration_20261021_085649_subscriber_prior_consent from './20261021_085649_subscriber_prior_consent';
import * as migration_20261021_105447_members from './20261021_105447_members';
import * as migration_20261021_160546_athlete_claims from './20261021_160546_athlete_claims';
import * as migration_20261102_180000_coaching from './20261102_180000_coaching';
import * as migration_20261103_120000_strava from './20261103_120000_strava';
import * as migration_20261119_120000_google_identities from './20261119_120000_google_identities';
import * as migration_20261123_120000_activity_metrics from './20261123_120000_activity_metrics';
import * as migration_20261127_120100_reviews from './20261127_120100_reviews';

export const migrations = [
  {
    up: migration_20261019_113052_initial.up,
    down: migration_20261019_113052_initial.down,
    name: '20261019_113052_initial',
  },
  {
    up: migration_20261019_114743_race_source_confirmed_by.up,
    down: migration_20261019_114743_race_source_confirmed_by.down,
    name: '20261019_114743_race_source_confirmed_by',
  },
  {
    up: migration_20261019_122421_editorial_live_and_revision.up,
    down: migration_20261019_122421_editorial_live_and_revision.down,
    name: '20261019_122421_editorial_live_and_revision',
  },
  {
    up: migration_20261019_123018_race_moderation_submitter.up,
    down: migration_20261019_123018_race_moderation_submitter.down,
    name: '20261019_123018_race_moderation_submitter',
  },
  {
    up: migration_20261019_153553_athletes_results.up,
    down: migration_20261019_153553_athletes_results.down,
    name: '20261019_153553_athletes_results',
  },
  {
    up: migration_20261019_153928_learning_centre.up,
    down: migration_20261019_153928_learning_centre.down,
    name: '20261019_153928_learning_centre',
  },
  {
    up: migration_20261019_154509_pages_and_enquiries.up,
    down: migration_20261019_154509_pages_and_enquiries.down,
    name: '20261019_154509_pages_and_enquiries',
  },
  {
    up: migration_20261020_024631_plans_and_resources.up,
    down: migration_20261020_024631_plans_and_resources.down,
    name: '20261020_024631_plans_and_resources',
  },
  {
    up: migration_20261020_032538_newsletter_subscribers.up,
    down: migration_20261020_032538_newsletter_subscribers.down,
    name: '20261020_032538_newsletter_subscribers',
  },
  {
    up: migration_20261020_033438_home_blocks.up,
    down: migration_20261020_033438_home_blocks.down,
    name: '20261020_033438_home_blocks',
  },
  {
    up: migration_20261021_085649_subscriber_prior_consent.up,
    down: migration_20261021_085649_subscriber_prior_consent.down,
    name: '20261021_085649_subscriber_prior_consent',
  },
  {
    up: migration_20261021_105447_members.up,
    down: migration_20261021_105447_members.down,
    name: '20261021_105447_members',
  },
  {
    up: migration_20261021_160546_athlete_claims.up,
    down: migration_20261021_160546_athlete_claims.down,
    name: '20261021_160546_athlete_claims'
  },
  {
    up: migration_20261102_180000_coaching.up,
    down: migration_20261102_180000_coaching.down,
    name: '20261102_180000_coaching',
  },
  {
    up: migration_20261103_120000_strava.up,
    down: migration_20261103_120000_strava.down,
    name: '20261103_120000_strava',
  },
  {
    up: migration_20261119_120000_google_identities.up,
    down: migration_20261119_120000_google_identities.down,
    name: '20261119_120000_google_identities',
  },
  {
    up: migration_20261123_120000_activity_metrics.up,
    down: migration_20261123_120000_activity_metrics.down,
    name: '20261123_120000_activity_metrics',
  },
  {
    up: migration_20261127_120100_reviews.up,
    down: migration_20261127_120100_reviews.down,
    name: '20261127_120100_reviews',
  },
];
