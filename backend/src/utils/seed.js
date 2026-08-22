require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, Doctor } = require('../models');

async function seed() {
  await sequelize.sync({ alter: true });

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const [admin] = await User.findOrCreate({
    where: { email: 'admin@clinic.example.com' },
    defaults: { name: 'Clinic Admin', password_hash: passwordHash, role: 'admin' },
  });

  const [doctorUser] = await User.findOrCreate({
    where: { email: 'dr.sharma@clinic.example.com' },
    defaults: { name: 'Anjali Sharma', password_hash: passwordHash, role: 'doctor', phone: '9876543210' },
  });

  await Doctor.findOrCreate({
    where: { user_id: doctorUser.id },
    defaults: {
      specialisation: 'General Physician',
      slot_duration_minutes: 30,
      working_hours: {
        mon: [['09:00', '13:00'], ['15:00', '18:00']],
        tue: [['09:00', '13:00'], ['15:00', '18:00']],
        wed: [['09:00', '13:00'], ['15:00', '18:00']],
        thu: [['09:00', '13:00'], ['15:00', '18:00']],
        fri: [['09:00', '13:00']],
        sat: [],
        sun: [],
      },
      bio: 'MBBS, MD - 12 years of experience in general medicine.',
      consultation_fee: 500,
    },
  });

  const [patient] = await User.findOrCreate({
    where: { email: 'patient@example.com' },
    defaults: { name: 'Rahul Verma', password_hash: passwordHash, role: 'patient', phone: '9123456780' },
  });

  console.log('Seeded demo accounts (password for all: Password123!):');
  console.log(` admin:   ${admin.email}`);
  console.log(` doctor:  ${doctorUser.email}`);
  console.log(` patient: ${patient.email}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
