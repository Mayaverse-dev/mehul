/**
 * Authentication Middleware & Session Helpers
 */

// Auth middleware - require user login
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/');
    }
}

// Backer middleware - require user to be a Kickstarter backer (not just logged in)
function requireBacker(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    // Check if user is an actual Kickstarter backer
    if (!req.session.backerNumber && !req.session.pledgeAmount && !req.session.rewardTitle) {
        // Logged in but not a backer - redirect to store
        return res.redirect('/');
    }
    next();
}

// Admin middleware - require admin login
function requireAdmin(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

// Set session data for authenticated user
function setUserSession(req, user) {
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.backerNumber = user.backer_number;
    req.session.backerName = user.backer_name;
    req.session.pledgeAmount = user.pledge_amount;
    req.session.rewardTitle = user.reward_title;
}

// Alias for setUserSession (some code uses this name)
function setSessionFromUser(req, user) {
    setUserSession(req, user);
}

module.exports = {
    requireAuth,
    requireBacker,
    requireAdmin,
    setUserSession,
    setSessionFromUser
};

