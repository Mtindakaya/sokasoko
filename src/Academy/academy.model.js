const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

// '21+' is the CLUB senior-team level. Older Academy rows never used
// it — safe to add to the enum without a migration.
const levels = ['21+', 'U20', 'U17', 'U15', 'U13', 'U11', 'U9'];

const AcademySchema = new Schema(
  {
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      autopopulate: true,
      unique: true,
    },
    level: {
      type: String,
      enum: levels,
      required: true,
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      autopopulate: true,
    },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

mongoose.plugin(actions);

module.exports = model('Academy', AcademySchema);
