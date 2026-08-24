"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayName = displayName;
/** Настоящее имя и фамилия, если пользователь их указал, иначе — имя из Telegram-профиля. */
function displayName(fullName, firstName) {
    return fullName || firstName;
}
