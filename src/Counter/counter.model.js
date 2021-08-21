const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const CounterSchema = new Schema({
  _id: String,
  seq_value: {
    type: Number,
  },
});

CounterSchema.pre('validate', function (done) {
  return this.preValidate(done);
});
CounterSchema.methods.preValidate = function preValidate(done) {
  return done(null, this);
};

CounterSchema.statics.getNextSequenceValue =
  async function getNextSequenceValue(sequenceName) {
    const Counter = this;
    let countValue;

    const counter = await Counter.findOne({ _id: sequenceName }).exec();

    if (!counter) {
      const newCounter = new Counter({
        _id: sequenceName,
        seq_value: 1,
      });
      const document = await newCounter.save();
      countValue = document.seq_value;
    } else {
      counter.seq_value += 1;
      const nextCount = await counter.save();
      countValue = nextCount.seq_value;
    }
    return Promise.resolve(countValue);
  };

mongoose.plugin(actions);

module.exports = model('Counter', CounterSchema);
