const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const Counter = require('../Counter/counter.model');

// One invoice per (scout, match) — issued the moment a scout has evaluated
// every player in the requester's team roster. Payment integration is stubbed
// (auto-marked PAID by the report handler right now) but the record and the
// mark-paid endpoint are here so Stripe/M-Pesa can drop in later without a
// schema change.
const ScoutInvoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, index: true, unique: true, sparse: true },

    // Parties
    scout: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The user who requested the scout — an academy user or the player who
    // filed the request via /matches/:id/request-scout.
    requester: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestType: { type: String, enum: ['ACADEMY', 'PLAYER'], required: true },

    // Context
    match: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    // The team being scouted (homeTeam or awayTeam user id).
    team: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    playerCount: { type: Number, default: 0 },

    // Cost breakdown
    scoutFeeTotal: { type: Number, default: 0 },        // what the scout charges
    platformCommissionPct: { type: Number, default: 20 }, // % taken from the scout
    platformCommission: { type: Number, default: 0 },   // scoutFeeTotal * pct
    additionalPlatformFee: { type: Number, default: 0 },// added to invoice (TBD)
    invoiceTotal: { type: Number, default: 0 },         // scoutFeeTotal + additionalPlatformFee
    scoutNet: { type: Number, default: 0 },             // scoutFeeTotal - platformCommission

    status: { type: String, enum: ['PENDING', 'PAID'], default: 'PENDING', index: true },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One invoice per scout+match — prevents duplicates if the last-report check
// fires twice due to a race.
ScoutInvoiceSchema.index({ scout: 1, match: 1 }, { unique: true });

ScoutInvoiceSchema.pre('save', async function (next) {
  if (this.isNew && !this.invoiceNumber) {
    try {
      const seq = await Counter.getNextSequenceValue('scoutInvoice');
      this.invoiceNumber = `TFH-INV-${seq.toString().padStart(6, '0')}`;
    } catch (e) {
      // Non-fatal — invoice can still exist without a pretty number.
      console.log('scoutInvoice number generation error:', e.message);
    }
  }
  next();
});

module.exports = model('ScoutInvoice', ScoutInvoiceSchema);
