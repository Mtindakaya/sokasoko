const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const AgentSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: String,
    associatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

AgentSchema.pre('validate', function (done) {
  return this.preValidate(done);
});

AgentSchema.methods.preValidate = function preValidate(done) {
  return done(null, this);
};

mongoose.plugin(actions);

module.exports = model('Agent', AgentSchema);
