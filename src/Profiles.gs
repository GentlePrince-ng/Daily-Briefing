/**
 * PROFILES — the only file you edit to point the engine at a new domain.
 *
 * A profile is the taxonomy plus the shape of the brief:
 *   analystRole    who the model is writing as
 *   audience       who reads the brief and what they decide with it
 *   focus          what to prioritise when deduplicating and ranking stories
 *   themes         closed list for `primary_theme` (structured output enum)
 *   dimensions     extra per-message fields, each becoming a Topics column
 *   entityTypes    closed list for extracted entities
 *   sections       domain sections, placed between the fixed opening
 *                  (Executive Summary, Major Developments, Emerging Signals)
 *                  and the fixed close (Risks, Follow-up, Source Notes)
 *
 * Select one with the PROFILE Script Property (default: brand-reputation).
 */

const PROFILES = {
  'brand-reputation': {
    label: 'Brand & reputation monitoring',
    analystRole: 'the reputation and communications analyst',
    audience: 'the communications and leadership team, who decide what to respond to today',
    focus: [
      'coverage that could change how customers, regulators or partners see the organisation',
      'complaints or criticism gaining traction across several outlets or accounts',
      'competitor moves that invite comparison',
    ],
    themes: ['Product & Service', 'Customer Experience', 'Leadership & Governance',
      'Regulation & Legal', 'Partnerships & Deals', 'Competitor Activity',
      'Crisis & Incident', 'Corporate Responsibility', 'Other'],
    dimensions: [
      { key: 'channel', header: 'Channel', description: 'Where the mention appeared',
        enum: ['News', 'Social', 'Blog', 'Forum', 'Review Site', 'Broadcast', 'Other'] },
      { key: 'product_line', header: 'Product/Line', description: 'Product, service or business line mentioned, or "None"' },
      { key: 'geography', header: 'Geography', description: 'Country or market the mention concerns, or "Global"' },
    ],
    entityTypes: ['Company', 'Person', 'Media', 'Regulator', 'Government', 'NGO', 'Other'],
    sections: ['Customer and Product Signals', 'Competitor Activity',
      'Regulatory and Legal Exposure', 'Response Options'],
  },

  'policy-regulatory': {
    label: 'Policy & regulatory monitoring',
    analystRole: 'the policy and regulatory affairs analyst',
    audience: 'the policy team, who decide which developments need a position, a meeting or a submission',
    focus: [
      'new or amended laws, regulations, guidance and consultations',
      'statements of intent from regulators, ministries and legislators',
      'implementation evidence that confirms or contradicts what was announced',
    ],
    themes: ['Legislation', 'Regulation & Guidance', 'Consultation', 'Enforcement',
      'Budget & Financing', 'Appointments', 'Implementation', 'Litigation', 'Other'],
    dimensions: [
      { key: 'jurisdiction', header: 'Jurisdiction', description: 'Country, state or body whose rule this is' },
      { key: 'instrument_stage', header: 'Stage', description: 'Lifecycle stage of the instrument',
        enum: ['Proposed', 'Consultation', 'Passed', 'In Force', 'Enforced', 'Repealed', 'Not Applicable'] },
      { key: 'sector', header: 'Sector', description: 'Sector affected, e.g. fintech, energy, agriculture, education' },
    ],
    entityTypes: ['Government', 'Regulator', 'Legislature', 'Court', 'Company',
      'Industry Body', 'NGO', 'Person', 'Other'],
    sections: ['New and Changing Rules', 'Consultations and Deadlines',
      'Implementation and Enforcement', 'Positions to Consider'],
  },

  'competitor-intel': {
    label: 'Competitor & market intelligence',
    analystRole: 'the market intelligence analyst',
    audience: 'the strategy and product team, who decide where to respond in the market',
    focus: [
      'launches, pricing changes and new markets entered by named competitors',
      'senior hires, departures, funding and M&A',
      'signals of demand shifting between providers',
    ],
    themes: ['Product Launch', 'Pricing', 'Market Entry/Exit', 'Funding & M&A',
      'Talent', 'Partnerships', 'Customer Wins/Losses', 'Technology', 'Other'],
    dimensions: [
      { key: 'competitor', header: 'Competitor', description: 'Competitor the mention is about, or "Market-wide"' },
      { key: 'segment', header: 'Segment', description: 'Customer segment or product category affected' },
      { key: 'geography', header: 'Geography', description: 'Country or market affected, or "Global"' },
    ],
    entityTypes: ['Company', 'Investor', 'Person', 'Media', 'Regulator', 'Other'],
    sections: ['Competitor Moves', 'Pricing and Packaging', 'Talent and Capital',
      'Implications for Us'],
  },

  'customer-feedback': {
    label: 'Customer feedback & support triage',
    analystRole: 'the customer insight analyst',
    audience: 'the support and product leads, who decide what to fix, escalate or answer first',
    focus: [
      'issues reported by several customers independently',
      'anything blocking payment, access or safety',
      'praise and feature requests that recur',
    ],
    themes: ['Bug/Defect', 'Billing & Payment', 'Access & Login', 'Performance',
      'Feature Request', 'Praise', 'Service Experience', 'Safety', 'Other'],
    dimensions: [
      { key: 'product_area', header: 'Product Area', description: 'Feature or product area concerned' },
      { key: 'customer_segment', header: 'Segment', description: 'Customer type if stated, else "Unknown"' },
      { key: 'urgency', header: 'Urgency', description: 'How soon this needs action',
        enum: ['Today', 'This Week', 'Backlog'] },
    ],
    entityTypes: ['Product', 'Feature', 'Company', 'Person', 'Other'],
    sections: ['Recurring Issues', 'Escalations', 'Feature Requests and Praise',
      'Suggested Fixes and Replies'],
  },

  'public-health': {
    label: 'Public health intelligence',
    analystRole: 'the public health intelligence analyst',
    audience: 'programme, advocacy and editorial teams, who decide what to verify, cover or raise with officials',
    focus: [
      'health policy, financing and governance decisions',
      'outbreaks, disease surveillance and health-security signals',
      'service-delivery evidence from facilities and communities',
    ],
    themes: ['Policy & Governance', 'Financing', 'Primary Health Care',
      'Maternal & Child Health', 'Disease Control', 'Health Security',
      'Health Workforce', 'Medicines & Supplies', 'Other'],
    dimensions: [
      { key: 'geography', header: 'Geography', description: 'Country and sub-national unit, e.g. "Country / State"' },
      { key: 'condition', header: 'Disease/Condition', description: 'Disease or condition, or "None"' },
      { key: 'development_type', header: 'Development Type', description: 'Announcement, data release, incident, commentary, etc.' },
    ],
    entityTypes: ['Government', 'Agency', 'Donor', 'NGO', 'Media', 'Academic',
      'Company', 'Person', 'Other'],
    sections: ['Policy, Financing and Governance', 'Service Delivery',
      'Disease Control and Health Security', 'Sub-national Developments',
      'Story and Advocacy Angles'],
  },
};

const DEFAULT_PROFILE_ID = 'brand-reputation';

// Fixed frame of every brief, whatever the profile.
const BRIEF_OPENING_SECTIONS = ['Executive Summary', 'Major Developments',
  'Emerging Narratives and Signals'];
const BRIEF_CLOSING_SECTIONS = ['Risks, Misinformation and Issues Requiring Verification',
  'Recommended Follow-up', 'Source Notes'];

/** Pure: returns the profile for `id`, or throws listing the valid ids. */
function resolveProfile_(id) {
  const key = String(id || DEFAULT_PROFILE_ID).trim();
  const profile = PROFILES[key];
  if (!profile) {
    throw new Error(`Unknown PROFILE "${key}". Valid: ${Object.keys(PROFILES).join(', ')}`);
  }
  validateProfile_(key, profile);
  return Object.assign({ id: key }, profile);
}

function getActiveProfile_() {
  return resolveProfile_(PropertiesService.getScriptProperties().getProperty('PROFILE'));
}

/**
 * Pure: fails loudly on a malformed profile instead of letting the model
 * receive a broken schema at midnight.
 */
function validateProfile_(id, p) {
  const problems = [];
  ['label', 'analystRole', 'audience'].forEach(k => {
    if (!p[k] || typeof p[k] !== 'string') problems.push(`${k} must be a non-empty string`);
  });
  ['focus', 'themes', 'entityTypes', 'sections'].forEach(k => {
    if (!Array.isArray(p[k]) || !p[k].length) problems.push(`${k} must be a non-empty array`);
  });
  if (Array.isArray(p.themes) && !p.themes.includes('Other')) {
    problems.push('themes must include "Other" so off-taxonomy messages still classify');
  }
  const reserved = new Set(['message_id', 'primary_theme', 'secondary_themes', 'sentiment',
    'risk_level', 'newsworthiness', 'confidence', 'rationale', 'entities']);
  const seen = new Set();
  (p.dimensions || []).forEach((d, i) => {
    if (!/^[a-z][a-z0-9_]*$/.test(d.key || '')) problems.push(`dimensions[${i}].key must be snake_case`);
    if (reserved.has(d.key)) problems.push(`dimensions[${i}].key "${d.key}" is reserved`);
    if (seen.has(d.key)) problems.push(`dimensions[${i}].key "${d.key}" is duplicated`);
    seen.add(d.key);
    if (!d.header) problems.push(`dimensions[${i}].header is required`);
    if (d.enum && (!Array.isArray(d.enum) || !d.enum.length)) {
      problems.push(`dimensions[${i}].enum must be a non-empty array when given`);
    }
  });
  const allSections = BRIEF_OPENING_SECTIONS.concat(p.sections || [], BRIEF_CLOSING_SECTIONS);
  if (new Set(allSections).size !== allSections.length) {
    problems.push('sections repeat one of the fixed brief sections');
  }
  if (problems.length) throw new Error(`Profile "${id}" is invalid: ${problems.join('; ')}`);
}

/** Pure: Topics sheet header row for a profile. */
function buildTopicHeaders_(profile) {
  return ['Message ID', 'Message Date', 'Primary Theme', 'Secondary Themes']
    .concat((profile.dimensions || []).map(d => d.header))
    .concat(['Sentiment', 'Risk Level', 'Newsworthiness', 'Confidence',
      'Rationale', 'AI Batch ID', 'Classified At', 'Profile']);
}
