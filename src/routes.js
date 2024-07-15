import express from 'express';
import { Contract, Job, Profile, sequelize } from './model.js';
import { Op } from 'sequelize';
import getProfile from './middleware/getProfile.js';

const router = express.Router();

router.use(getProfile);

router.get('/contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findOne({
      where: {
        id,
        [Op.or]: [
          { ClientId: req.profile.id },
          { ContractorId: req.profile.id }
        ]
      }
    });

    if (!contract) {
      return res.status(404).end();
    }

    res.json(contract);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.get('/contracts', async (req, res) => {
  try {
    const contracts = await Contract.findAll({
      where: {
        [Op.or]: [
          { ClientId: req.profile.id },
          { ContractorId: req.profile.id }
        ],
        status: { [Op.ne]: 'terminated' }
      }
    });
    res.json(contracts);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.get('/jobs/unpaid', async (req, res) => {
  try {
    const jobs = await Job.findAll({
      where: { paid: false },
      include: {
        model: Contract,
        where: {
          status: 'in_progress',
          [Op.or]: [
            { ClientId: req.profile.id },
            { ContractorId: req.profile.id }
          ]
        }
      }
    });

    res.json(jobs);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.post('/jobs/:job_id/pay', async (req, res) => {
  try {
    const { job_id } = req.params;
    const job = await Job.findOne({
      where: { id: job_id, paid: false },
      include: Contract
    });

    if (!job) {
      return res.status(404).end();
    }

    if (job.Contract.ClientId !== req.profile.id) {
      return res.status(403).end();
    }

    if (req.profile.balance < job.price) {
      return res.status(400).send('Insufficient funds');
    }

    const client = await Profile.findByPk(job.Contract.ClientId);
    const contractor = await Profile.findByPk(job.Contract.ContractorId);

    await client.update({ balance: client.balance - job.price });
    await contractor.update({ balance: contractor.balance + job.price });
    await job.update({ paid: true });

    res.json(job);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.post('/balances/deposit/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount } = req.body;

    const user = await Profile.findByPk(userId);
    const totalJobsToPay = await Job.sum('price', {
      where: { paid: false },
      include: {
        model: Contract,
        where: { ClientId: userId, status: 'in_progress' }
      }
    });

    if (amount > 0.25 * totalJobsToPay) {
      return res.status(400).send('Cannot deposit more than 25% of total jobs to pay');
    }

    await user.update({ balance: user.balance + amount });
    res.json(user);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.get('/admin/best-profession', async (req, res) => {
  try {
    const { start, end } = req.query;
    const [result] = await sequelize.query(
      `SELECT Profile.profession, SUM(Job.price) as total
       FROM Jobs
       JOIN Contracts ON Jobs.ContractId = Contracts.id
       JOIN Profiles ON Contracts.ContractorId = Profiles.id
       WHERE Jobs.paid = true AND Jobs.paymentDate BETWEEN ? AND ?
       GROUP BY Profiles.profession
       ORDER BY total DESC
       LIMIT 1`,
      { replacements: [start, end] }
    );

    res.json(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.get('/admin/best-clients', async (req, res) => {
  try {
    const { start, end, limit = 2 } = req.query;
    const [results] = await sequelize.query(
      `SELECT Profiles.id, Profiles.firstName || ' ' || Profiles.lastName as fullName, SUM(Jobs.price) as paid
       FROM Jobs
       JOIN Contracts ON Jobs.ContractId = Contracts.id
       JOIN Profiles ON Contracts.ClientId = Profiles.id
       WHERE Jobs.paid = true AND Jobs.paymentDate BETWEEN ? AND ?
       GROUP BY Profiles.id
       ORDER BY paid DESC
       LIMIT ?`,
      { replacements: [start, end, parseInt(limit)] }
    );

    res.json(results);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

export default router;
