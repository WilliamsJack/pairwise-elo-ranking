export const PLACEHOLDER_DOCS = `\`\`\`glicko-placeholders
Available {{glicko:...}} placeholders - edit this template freely.

Scalar
  {{glicko:cohort}}            Cohort label or key
  {{glicko:date}}              YYYY-MM-DD
  {{glicko:datetime}}          YYYY-MM-DD HH:mm:ss
  {{glicko:duration}}          Session duration (e.g. 12m 34s)
  {{glicko:match-count}}       Number of matches played
  {{glicko:unique-players}}    Distinct player count
  {{glicko:draw-rate}}         e.g. 42%
  {{glicko:new-entrants}}      Count (or 0)
  {{glicko:file-count}}        Total files in cohort
  {{glicko:stability-delta}}   Avg sigma change for session participants

Block (pre-rendered markdown) - append :N to limit rows, e.g. {{glicko:gains-list:5}}
  {{glicko:gains-list}}              List of biggest rating gains
  {{glicko:losses-list}}             List of biggest rating losses
  {{glicko:match-log}}               Chronological list of match results
  {{glicko:surprises-list}}          List of most surprising results
  {{glicko:new-entrants-list}}       List of new entrants
  {{glicko:most-stable-list}}        Session participants by lowest σ
  {{glicko:most-stable-list-all}}    Entire cohort by lowest σ
  {{glicko:least-stable-list}}       Session participants by highest σ
  {{glicko:least-stable-list-all}}   Entire cohort by highest σ
  {{glicko:leaderboard-table}}       Session participants ranked by rating
  {{glicko:leaderboard-table-all}}   Entire cohort ranked by rating
\`\`\`
`;

export const DEFAULT_REPORT_TEMPLATE = `## {{glicko:cohort}} - {{glicko:datetime}}

- **Session duration:** {{glicko:duration}}
- **Matches played:** {{glicko:match-count}}
- **Unique players:** {{glicko:unique-players}} of {{glicko:file-count}} total
- **New entrants:** {{glicko:new-entrants}}
- **Draw rate:** {{glicko:draw-rate}}
- **Stability change:** {{glicko:stability-delta}}

## Biggest Gains

{{glicko:gains-list:5}}

## Biggest Losses

{{glicko:losses-list:5}}

## Most Surprising Results

{{glicko:surprises-list:5}}

## New Entrants

{{glicko:new-entrants-list}}

## Most Stable

{{glicko:most-stable-list:5}}

## Least Stable

{{glicko:least-stable-list:5}}

## Leaderboard Snapshot

{{glicko:leaderboard-table:10}}

## Match Log

{{glicko:match-log}}`;
