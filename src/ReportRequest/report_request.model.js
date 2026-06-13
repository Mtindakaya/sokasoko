const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

const ReportRequestSchema = new Schema(
  {
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'requestedBy is required'],
      index: true,
    },
    reportType: {
      type: String,
      enum: ['PLAYER', 'REFEREE', 'COACH', 'VENUE'],
      required: [true, 'reportType is required'],
    },
    filters: {
      region: { type: String },
      district: { type: String },
      gender: { type: String },
      position: { type: String },
      nationality: { type: String },
      minAge: { type: String },
      maxAge: { type: String },
    },
    dateFrom: { type: Date, default: null },
    dateTo: { type: Date, default: null },
    status: {
      type: String,
      enum: ['PENDING_PAYMENT', 'PAID', 'GENERATING', 'FULFILLED', 'CANCELLED'],
      default: 'PENDING_PAYMENT',
      index: true,
    },
    price: { type: Number, default: 3000 },
    isSelfReport: { type: Boolean, default: false },
    paymentRef: { type: String, trim: true },
    reportUrl: { type: String, trim: true },
    notes: { type: String, trim: true },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    generatedAt: { type: Date, default: null },
  },
  SCHEMA_OPTIONS
);

module.exports = model('ReportRequest', ReportRequestSchema);
