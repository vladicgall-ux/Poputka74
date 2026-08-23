"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingsRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const ratingService_1 = require("../../services/ratingService");
exports.ratingsRouter = (0, express_1.Router)();
exports.ratingsRouter.use(auth_1.requireTelegramAuth, auth_1.requireActiveUser);
exports.ratingsRouter.post('/', (req, res) => {
    const { user } = req;
    const rideId = Number(req.body?.rideId);
    const rating = Number(req.body?.rating);
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 300) : undefined;
    if (!Number.isInteger(rideId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        res.status(400).json({ error: 'Некорректная оценка' });
        return;
    }
    try {
        const record = (0, ratingService_1.createRating)({ rideId, passengerId: user.telegram_id, rating, comment });
        res.status(201).json({ rating: record });
    }
    catch (err) {
        if (err instanceof ratingService_1.RatingError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
