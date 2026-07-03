const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const ScoutReportSchema = new Schema({
  scout:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  player:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  eventId: { type: String, required: true },   // trialId or matchId
  eventType: { type: String, enum: ['TRIAL', 'MATCH'], required: true },
  isOfficial: { type: Boolean, default: false },
  playerPosition: { type: String },

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
}, { timestamps: true });

// One evaluation per scout per player per event
ScoutReportSchema.index({ scout: 1, player: 1, eventId: 1 }, { unique: true });

module.exports = model('ScoutReport', ScoutReportSchema);
