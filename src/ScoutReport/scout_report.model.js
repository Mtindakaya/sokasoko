const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const Counter = require('../Counter/counter.model');

const ScoutReportSchema = new Schema({
  scout:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  player:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  eventId: { type: String, required: true },   // trialId or matchId
  eventType: { type: String, enum: ['TRIAL', 'MATCH'], required: true },
  isOfficial: { type: Boolean, default: false },
  playerPosition: { type: String },

  // Human-friendly evaluation ID surfaced on printed reports.
  // Format: S{scoutDigits}_P{playerDigits}_{DDMMYY}_{5-digit global counter}
  // Example: S000072_P000031_230726_00001
  // Computed in a pre-save hook so existing rows keep null until re-saved.
  evaluationId: { type: String, index: true, unique: true, sparse: true },

  // Template 1 — Physical
  acceleration_5m:     { type: Number, min: 1, max: 10 },
  top_speed_30m:       { type: Number, min: 1, max: 10 },
  agility_balance:     { type: Number, min: 1, max: 10 },
  stamina_workrate:    { type: Number, min: 1, max: 10 },
  functional_strength: { type: Number, min: 1, max: 10 },

  // Template 1 — Technical
  first_touch:           { type: Number, min: 1, max: 10 },
  passing_accuracy:      { type: Number, min: 1, max: 10 },
  dribbling_ball_control:{ type: Number, min: 1, max: 10 },

  // Template 1 — Cognitive
  scanning_frequency:      { type: Number, min: 1, max: 10 },
  composure_under_pressure:{ type: Number, min: 1, max: 10 },
  emotional_resilience:    { type: Number, min: 1, max: 10 },

  // Template 1 — Summary
  standout_trait:    { type: String, trim: true },
  primary_deficiency:{ type: String, trim: true },
  scout_verdict:     { type: String, enum: ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'] },
  overall_rating:    { type: Number, min: 1, max: 10 },

  // Template 2 — Position-specific (CB)
  aerial_dominance:        { type: Number, min: 1, max: 10 },
  tackling_1v1:            { type: Number, min: 1, max: 10 },
  line_organization:       { type: Number, min: 1, max: 10 },
  progressive_distribution:{ type: Number, min: 1, max: 10 },

  // Template 2 — FB/WB
  touchline_engine:    { type: Number, min: 1, max: 10 },
  wide_1v1_defending:  { type: Number, min: 1, max: 10 },
  delivery_quality:    { type: Number, min: 1, max: 10 },
  recovery_positioning:{ type: Number, min: 1, max: 10 },

  // Template 2 — CM/DM/AM
  body_shape_reception:  { type: Number, min: 1, max: 10 },
  spatial_pocket_finding:{ type: Number, min: 1, max: 10 },
  tempo_control:         { type: Number, min: 1, max: 10 },
  line_breaking_vision:  { type: Number, min: 1, max: 10 },

  // Template 2 — Wingers
  isolation_elimination:     { type: Number, min: 1, max: 10 },
  unpredictability_variation:{ type: Number, min: 1, max: 10 },
  far_post_runs:             { type: Number, min: 1, max: 10 },
  counter_press_trigger:     { type: Number, min: 1, max: 10 },

  // Template 2 — Strikers
  box_movement_timing:        { type: Number, min: 1, max: 10 },
  finishing_efficiency:       { type: Number, min: 1, max: 10 },
  hold_up_link_play:          { type: Number, min: 1, max: 10 },
  defensive_pressing_leader:  { type: Number, min: 1, max: 10 },

  // Template 2 — Goalkeepers
  shot_stopping:          { type: Number, min: 1, max: 10 },
  gk_command_of_area:     { type: Number, min: 1, max: 10 },
  gk_distribution:        { type: Number, min: 1, max: 10 },
  one_v_one_gk:           { type: Number, min: 1, max: 10 },
  gk_positioning_reading: { type: Number, min: 1, max: 10 },
}, { timestamps: true });

// One evaluation per scout per player per event
ScoutReportSchema.index({ scout: 1, player: 1, eventId: 1 }, { unique: true });

// Extract the 6-digit suffix from a TFH accountNumber like 'TFH-S-A000072'
// or 'TFH-P-A000031'. Returns just the numeric portion (e.g. '000072').
function extractAccountDigits(accountNumber) {
  if (!accountNumber || typeof accountNumber !== 'string') return null;
  const m = accountNumber.match(/(\d{4,})\s*$/);
  return m ? m[1].padStart(6, '0').slice(-6) : null;
}

function formatDdmmyy(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  return `${dd}${mm}${yy}`;
}

ScoutReportSchema.pre('save', async function preEvaluationId(next) {
  if (!this.isNew || this.evaluationId) return next();
  try {
    const User = mongoose.model('User');
    const [scoutUser, playerUser] = await Promise.all([
      User.findById(this.scout).select('accountNumber').lean(),
      User.findById(this.player).select('accountNumber').lean(),
    ]);
    const scoutDigits =
      extractAccountDigits(scoutUser && scoutUser.accountNumber) || '000000';
    const playerDigits =
      extractAccountDigits(playerUser && playerUser.accountNumber) || '000000';
    const dateStr = formatDdmmyy(new Date());
    const seq = await Counter.getNextSequenceValue('scoutEvaluation');
    const seqStr = String(seq).padStart(5, '0');
    this.evaluationId = `S${scoutDigits}_P${playerDigits}_${dateStr}_${seqStr}`;
    return next();
  } catch (err) {
    // Non-fatal: report still saves without a human ID; will get one next
    // time it's re-saved.
    console.log('evaluationId generation error:', err.message);
    return next();
  }
});

module.exports = model('ScoutReport', ScoutReportSchema);
