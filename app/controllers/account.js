//
// Account Controller
//

'use strict';

var _ = require('underscore'),
    fs = require('fs'),
    passport = require('passport'),
    auth = require('./../auth/index'),
    path = require('path'),
    settings = require('./../config');

module.exports = function() {

    var app = this.app,
        core = this.core,
        middlewares = this.middlewares,
        models = this.models,
        User = models.user;

    //
    // Routes
    //
    app.get('/', middlewares.requireLogin, function(req, res) {
        res.render('chat.html', {
            account: req.user,
            settings: settings
        });
    });

    app.get('/login', function(req, res) {
        var imagePath = path.resolve('media/img/photos');
        var images = fs.readdirSync(imagePath);
        var image = _.chain(images).filter(function(file) {
            return /\.(gif|jpg|jpeg|png)$/i.test(file);
        }).sample().value();
        res.render('login.html', {
            photo: image,
            auth: auth.providers
        });
    });

    app.get('/logout', function(req, res ) {
        req.session.destroy();
        res.redirect('/login');
    });

    app.post('/account/login', function(req, res) {
        req.io.route('account:login');
    });

    app.post('/account/register', function(req, res) {
        req.io.route('account:register');
    });

    app.get('/account', middlewares.requireLogin, function(req, res) {
        req.io.route('account:whoami');
    });

    app.post('/account/profile', middlewares.requireLogin, function(req, res) {
        req.io.route('account:profile');
    });

    app.post('/account/settings', middlewares.requireLogin, function(req, res) {
        req.io.route('account:settings');
    });

    app.post('/account/token/generate', middlewares.requireLogin, function(req, res) {
        req.io.route('account:generate_token');
    });

    app.post('/account/token/revoke', middlewares.requireLogin, function(req, res) {
        req.io.route('account:revoke_token');
    });

    //
    // Sockets
    //
    app.io.route('account', {
        whoami: function(req) {
            req.io.respond(req.user);
        },
        profile: function(req) {
            var form = req.body || req.data,
                data = {
                    displayName: form.displayName || form['display-name'],
                    firstName: form.firstName || form['first-name'],
                    lastName: form.lastName || form['last-name']
                };

            core.account.update(req.user._id, data, function (err, user) {
                if (err) {
                    return req.io.respond({
                        status: 'error',
                        message: 'Unable to update your profile.',
                        errors: err
                    });
                }

                if (!user) {
                    return req.io.sendStatus(404);
                }

                req.io.respond(user);
                app.io.broadcast('users:update', user);
            });
        },
        settings: function(req) {
            if (req.user.using_token) {
                return req.io.status(403).respond({
                    status: 'error',
                    message: 'Cannot change account settings ' +
                             'when using token authentication.'
                });
            }

            var form = req.body || req.data,
                data = {
                    username: form.username,
                    email: form.email,
                    currentPassword: form.password ||
                        form['current-password'] || form.currentPassword,
                    newPassword: form['new-password'] || form.newPassword,
                    confirmPassowrd: form['confirm-password'] ||
                        form.confirmPassword
                };

            auth.authenticate(req.user.uid || req.user.username,
                              data.currentPassword, function(err, user) {
                if (err) {
                    return req.io.status(400).respond({
                        status: 'error',
                        message: 'There were problems authenticating you.',
                        errors: err
                    });
                }

                if (!user) {
                    return req.io.status(401).respond({
                        status: 'error',
                        message: 'Incorrect login credentials.'
                    });
                }

                core.account.update(req.user._id, data, function (err, user, reason) {
                    if (err || !user) {
                        return req.io.status(400).respond({
                            status: 'error',
                            message: 'Unable to update your account.',
                            reason: reason,
                            errors: err
                        });
                    }
                    req.io.respond(user);
                    app.io.broadcast('users:update', user);
                });
            });
        },
        generate_token: function(req) {
            if (req.user.using_token) {
                return req.io.status(403).respond({
                    status: 'error',
                    message: 'Cannot generate a new token ' +
                             'when using token authentication.'
                });
            }

            core.account.generateToken(req.user._id, function (err, token) {
                if (err) {
                    return req.io.respond({
                        status: 'error',
                        message: 'Unable to generate a token.',
                        errors: err
                    });
                }

                req.io.respond({
                    status: 'success',
                    message: 'Token generated.',
                    token: token
                });
            });
        },
        revoke_token: function(req) {
            if (req.user.using_token) {
                return req.io.status(403).respond({
                    status: 'error',
                    message: 'Cannot revoke token ' +
                             'when using token authentication.'
                });
            }

            core.account.revokeToken(req.user._id, function (err) {
                if (err) {
                    return req.io.respond({
                        status: 'error',
                        message: 'Unable to revoke token.',
                        errors: err
                    });
                }

                req.io.respond({
                    status: 'success',
                    message: 'Token revoked.'
                });
            });
        },
        register: function(req) {

            if (req.user ||
                !auth.providers.local ||
                !auth.providers.local.enable_registration) {

                return req.io.status(403).respond({
                    status: 'error',
                    message: 'Permission denied'
                });
            }

            var fields = req.body || req.data;

            var data = {
                provider: 'local',
                username: fields.username,
                email: fields.email,
                password: fields.password,
                firstName: fields.firstName || fields.firstname || fields['first-name'],
                lastName: fields.lastName || fields.lastname || fields['last-name'],
                displayName: fields.displayName || fields.displayname || fields['display-name']
            };

            core.account.create('local', data, function(err, user) {
                if (err) {
                    var message = 'Sorry, we could not process your request';
                    // User already exists
                    if (err.code === 11000) {
                        message = 'Email has already been taken';
                    }
                    // Invalid username
                    if (err.errors) {
                        message = _.map(err.errors, function(error) {
                            return error.message;
                        }).join(' ');
                    // If all else fails...
                    } else {
                        console.error(err);
                    }
                    // Notify
                    return req.io.status(400).respond({
                        status: 'error',
                        message: message
                    });
                }

                req.io.status(201).respond({
                    status: 'success',
                    message: 'You\'ve been registered, ' +
                             'please try logging in now!'
                });
            });
        },
        login: function(req) {
            auth.authenticate(req.body.username, req.body.password,
                                                 function(err, user, info) {
                if (err) {
                    return req.io.status(400).respond({
                        status: 'error',
                        message: 'There were problems logging you in.',
                        errors: err
                    });
                }

                if (!user && info && info.locked) {
                    return req.io.status(403).respond({
                        status: 'error',
                        message: info.message || 'Account is locked.'
                    });
                }

                if (!user) {
                    return req.io.status(401).respond({
                        status: 'error',
                        message: info && info.message ||
                                 'Incorrect login credentials.'
                    });
                }
                
                req.login(user, function(err) {
                    if (err) {
                        return req.io.status(400).respond({
                            status: 'error',
                            message: 'There were problems logging you in.',
                            errors: err
                        });
                    }
                    req.io.respond({
                        status: 'success',
                        message: 'Logging you in...'
                    });
                });
            });
        }
    });
};
