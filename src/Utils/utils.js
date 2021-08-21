const bcrypt = require('bcryptjs');

const generateHash = async (password, saltRounds = 10) => {
  try {
    //   Generate Salt
    const salt = await bcrypt.genSalt(saltRounds);
    const payload = await bcrypt.hash(password, salt);
    return payload;
  } catch (error) {
    throw Error(error);
  }
};

const compare = async (password, hash) => {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.log(error); //eslint-disable-line
  }
  return false;
};

const leftFillNum = (num, targetLength) => {
  return num.toString().padStart(targetLength, 0);
};

module.exports = { generateHash, compare, leftFillNum };
