const request = require('supertest');
const app = require('./app.js');
const { Contract, Job, Profile, sequelize } = require('./model.js');
const { Op } = require('sequelize');

describe('Contract API Unit Tests', () => {
  const mockProfile = { id: 1, firstName: 'John', lastName: 'Doe', profession: 'contractor', balance: 100 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  Contract.findOneByIdForProfile = async (profileId, contractId) => {
    return await Contract.findOne({
      where: {
        id: contractId,
        [Op.or]: [
          { ClientId: profileId },
          { ContractorId: profileId }
        ]
      }
    });
  };

  Contract.findAllForProfile = async (profileId) => {
    return await Contract.findAll({
      where: {
        [Op.or]: [
          { ClientId: profileId },
          { ContractorId: profileId }
        ],
        status: { [Op.ne]: 'terminated' }
      }
    });
  };

  Job.findUnpaidJobsForProfile = async (profileId) => {
    return await Job.findAll({
      where: { paid: false },
      include: {
        model: Contract,
        where: {
          status: 'in_progress',
          [Op.or]: [
            { ClientId: profileId },
            { ContractorId: profileId }
          ]
        }
      }
    });
  };

  Job.payForJob = async (profileId, jobId) => {
    const job = await Job.findOne({
      where: { id: jobId },
      include: { model: Contract }
    });

    if (job && job.Contract.ClientId === profileId && !job.paid) {
      const profile = await Profile.findByPk(profileId);
      if (profile.balance >= job.price) {
        await Profile.update({ balance: profile.balance - job.price }, { where: { id: profileId } });
        await Profile.update({ balance: profile.balance + job.price }, { where: { id: job.Contract.ContractorId } });
        job.paid = true;
        await Job.update({ paid: true }, { where: { id: jobId } });
        return job;
      }
    }
    return null;
  };

  Profile.depositMoney = async (profileId, amount) => {
    const profile = await Profile.findByPk(profileId);
    profile.balance += amount;
    await Profile.update({ balance: profile.balance }, { where: { id: profileId } });
    return profile;
  };

  Profile.getBestProfession = async (startDate, endDate) => {
    const result = await sequelize.query(
      'SELECT Profile.profession, SUM(Job.price) as total FROM Jobs AS Job INNER JOIN Profiles AS Profile ON Job.ContractId = Profile.id WHERE Job.paid = 1 AND Job.createdAt BETWEEN :startDate AND :endDate GROUP BY Profile.profession ORDER BY total DESC LIMIT 1',
      { replacements: { startDate, endDate }, type: sequelize.QueryTypes.SELECT }
    );
    return result[0];
  };

  Profile.getBestClients = async (startDate, endDate, limit) => {
    const results = await sequelize.query(
      'SELECT Profile.id, Profile.firstName || \' \' || Profile.lastName as fullName, SUM(Job.price) as paid FROM Jobs AS Job INNER JOIN Profiles AS Profile ON Job.ContractId = Profile.id WHERE Job.paid = 1 AND Job.createdAt BETWEEN :startDate AND :endDate GROUP BY Profile.id ORDER BY paid DESC LIMIT :limit',
      { replacements: { startDate, endDate, limit }, type: sequelize.QueryTypes.SELECT }
    );
    return results;
  };

  it('should find a contract by ID if it belongs to the profile', async () => {
    const mockContract = { id: 1, terms: 'Sample terms', ClientId: mockProfile.id, ContractorId: 2, status: 'in_progress' };
    jest.spyOn(Contract, 'findOne').mockResolvedValue(mockContract);

    const contract = await Contract.findOneByIdForProfile(mockProfile.id, 1);

    expect(contract).toEqual(mockContract);
    expect(Contract.findOne).toHaveBeenCalledWith({
      where: {
        id: 1,
        [Op.or]: [
          { ClientId: mockProfile.id },
          { ContractorId: mockProfile.id }
        ]
      }
    });
  });

  it('should return contracts belonging to the profile', async () => {
    const mockContracts = [
      { id: 1, ClientId: mockProfile.id },
      { id: 2, ContractorId: mockProfile.id }
    ];
    jest.spyOn(Contract, 'findAll').mockResolvedValue(mockContracts);

    const contracts = await Contract.findAllForProfile(mockProfile.id);

    expect(contracts).toEqual(mockContracts);
    expect(Contract.findAll).toHaveBeenCalledWith({
      where: {
        [Op.or]: [
          { ClientId: mockProfile.id },
          { ContractorId: mockProfile.id }
        ],
        status: { [Op.ne]: 'terminated' }
      }
    });
  });

  it('should return unpaid jobs for the profile', async () => {
    const mockJobs = [
      { id: 1, price: 50, paid: false },
      { id: 2, price: 75, paid: false }
    ];
    jest.spyOn(Job, 'findAll').mockResolvedValue(mockJobs);

    const jobs = await Job.findUnpaidJobsForProfile(mockProfile.id);

    expect(jobs).toEqual(mockJobs);
    expect(Job.findAll).toHaveBeenCalledWith({
      where: { paid: false },
      include: {
        model: Contract,
        where: {
          status: 'in_progress',
          [Op.or]: [
            { ClientId: mockProfile.id },
            { ContractorId: mockProfile.id }
          ]
        }
      }
    });
  });

  it('should pay for a job if conditions are met', async () => {
    const mockJob = { id: 1, Contract: { ClientId: mockProfile.id, ContractorId: 2 }, price: 50, paid: false };
    jest.spyOn(Job, 'findOne').mockResolvedValue(mockJob);
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(mockProfile);
    jest.spyOn(Profile, 'update').mockResolvedValue([1]);

    const paidJob = await Job.payForJob(mockProfile.id, 1);

    expect(paidJob.paid).toBe(true);
    expect(Profile.findByPk).toHaveBeenCalledWith(mockProfile.id);
    expect(Profile.update).toHaveBeenCalledTimes(2);
  });

  it('should deposit money into the profile balance', async () => {
    const depositAmount = 100;
    const expectedBalance = mockProfile.balance + depositAmount;
    const updatedProfile = { ...mockProfile, balance: expectedBalance };

    jest.spyOn(Profile, 'findByPk').mockResolvedValue(mockProfile);
    jest.spyOn(Profile, 'update').mockResolvedValue([1, [updatedProfile]]);

    const result = await Profile.depositMoney(mockProfile.id, depositAmount);

    expect(result.balance).toBe(expectedBalance);
    expect(Profile.findByPk).toHaveBeenCalledWith(mockProfile.id);
    expect(Profile.update).toHaveBeenCalledTimes(1);
  });

  it('should return the best profession that earned the most money', async () => {
    const mockResult = { profession: 'Engineer', total: 1000 };
    jest.spyOn(sequelize, 'query').mockResolvedValue([mockResult]);

    const result = await Profile.getBestProfession('2024-01-01', '2024-12-31');

    expect(result).toEqual(mockResult);
    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT Profile.profession, SUM(Job.price) as total'),
      { replacements: { startDate: '2024-01-01', endDate: '2024-12-31' }, type: sequelize.QueryTypes.SELECT }
    );
  });

  it('should return the best clients that paid the most for jobs within the date range', async () => {
    const mockResults = [
      { id: 1, fullName: 'John Doe', paid: 500 },
      { id: 2, fullName: 'Jane Smith', paid: 400 }
    ];
    jest.spyOn(sequelize, 'query').mockResolvedValue(mockResults);

    const results = await Profile.getBestClients('2024-01-01', '2024-12-31', 2);

    expect(results).toEqual(mockResults);
    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT Profile.id, Profile.firstName || \' \' || Profile.lastName as fullName, SUM(Job.price) as paid'),
      { replacements: { startDate: '2024-01-01', endDate: '2024-12-31', limit: 2 }, type: sequelize.QueryTypes.SELECT }
    );
  });
});
