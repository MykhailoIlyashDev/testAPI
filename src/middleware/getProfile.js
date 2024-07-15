import { Profile } from '../model.js';

const getProfile = async (req, res, next) => {
  try {
    const profileId = req.get('profile_id');
    if (!profileId) return res.status(401).end();

    const profile = await Profile.findByPk(profileId);
    if (!profile) return res.status(401).end();

    req.profile = profile;
    next();
  } catch (error) {
    res.status(500).send(error.message);
  }
};

export default getProfile; 
