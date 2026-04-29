const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

const RESERVATION_STATUS = ['PENDING', 'CONFIRMED', 'REJECTED', 'UNCONFIRMED'];

const ReservationSchema = new Schema(
  {
    venue: {
      type: Schema.Types.ObjectId,
      ref: 'Venue',
      required: [true, 'Venue is required'],
      index: true,
    },
    match: {
      type: Schema.Types.ObjectId,
      ref: 'Match',
      required: [true, 'Match is required'],
      index: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Requested by is required'],
    },
    date: {
      type: Date,
      required: [true, 'Reservation date is required'],
      index: true,
    },
    startTime: {
      type: String,
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: String,
    },
    status: {
      type: String,
      enum: RESERVATION_STATUS,
      default: 'PENDING',
      index: true,
    },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  SCHEMA_OPTIONS
);

ReservationSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

ReservationSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Reservation', ReservationSchema);
module.exports.RESERVATION_STATUS = RESERVATION_STATUS;
