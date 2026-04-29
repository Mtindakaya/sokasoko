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

const SURFACE_TYPES = ['NATURAL_GRASS', 'ARTIFICIAL_TURF', 'CLAY', 'CONCRETE', 'SAND'];
const VENUE_STATUS = ['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE'];

const VenueSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Venue name is required'],
      trim: true,
      searchable: true,
      index: true,
    },
    region: {
      type: String,
      required: [true, 'Region is required'],
      trim: true,
      index: true,
    },
    district: {
      type: String,
      required: [true, 'District is required'],
      trim: true,
      index: true,
    },
    ward: {
      type: String,
      trim: true,
    },
    serikaliYaMtaa: {
      type: String,
      trim: true,
    },
    street: {
      type: String,
      trim: true,
    },
    capacity: {
      type: Number,
      default: 0,
    },
    surfaceType: {
      type: String,
      enum: SURFACE_TYPES,
      default: 'NATURAL_GRASS',
    },
    status: {
      type: String,
      enum: VENUE_STATUS,
      default: 'ACTIVE',
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    photo: {
      type: String,
      default: null,
    },
    // Up to 2 field owners
    owners: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  SCHEMA_OPTIONS
);

VenueSchema.index({
  name: 'text',
  region: 'text',
  district: 'text',
});

VenueSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

VenueSchema.methods.preValidate = async function preValidate(done) {
  if (this.owners && this.owners.length > 2) {
    return done(new Error('A venue can have at most 2 field owners'));
  }
  return done();
};

mongoose.plugin(actions);

module.exports = model('Venue', VenueSchema);
module.exports.SURFACE_TYPES = SURFACE_TYPES;
module.exports.VENUE_STATUS = VENUE_STATUS;
