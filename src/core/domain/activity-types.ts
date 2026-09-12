// Canonical activity taxonomy. App-owned (DECISIONS D-019). Bodies map their labels onto these keys.
// Adding a key is a code change reviewed by PR; catalog files may only use keys listed here.
export const ACTIVITY_TYPES = [
  'attend_training',
  'attend_conference',
  'attend_webinar',
  'self_study_timed',
  'read_book',
  'read_article',
  'deliver_training',
  'deliver_presentation',
  'mentor',
  'publish_article',
  'publish_book',
  'develop_content',
  'volunteer',
  'earn_certification',
  'higher_education',
  'vendor_exam',
  'other',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  attend_training: 'Attended training course',
  attend_conference: 'Attended conference / seminar',
  attend_webinar: 'Attended webinar / podcast',
  self_study_timed: 'Self-study (timed)',
  read_book: 'Read a book',
  read_article: 'Read an article / magazine',
  deliver_training: 'Delivered training',
  deliver_presentation: 'Delivered a presentation',
  mentor: 'Mentoring',
  publish_article: 'Published an article',
  publish_book: 'Published a book',
  develop_content: 'Developed content / exam items',
  volunteer: 'Volunteer work',
  earn_certification: 'Earned another certification',
  higher_education: 'Higher education course',
  vendor_exam: 'Vendor exam / assessment',
  other: 'Other (no automatic suggestions)',
};

/** Activities that are counted per occurrence rather than by duration. */
export const ITEM_BASED_TYPES: ReadonlySet<ActivityType> = new Set([
  'read_book',
  'publish_article',
  'publish_book',
  'earn_certification',
  'vendor_exam',
]);
