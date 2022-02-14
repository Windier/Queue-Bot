"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Base = void 0;
const discord_js_1 = require("discord.js");
const fs_1 = require("fs");
const knex_1 = require("knex");
const MessageCollection_1 = require("./MessageCollection");
const lodash_1 = __importDefault(require("lodash"));
class Base {
    static isMe(member) {
        return member?.id === member?.guild?.me?.id;
    }
    static haveCommandsChanged() {
        return !lodash_1.default.isEqual(this.commands, this.lastCommands);
    }
    static archiveCommands() {
        (0, fs_1.writeFileSync)("../data/last-commands-config.json", (0, fs_1.readFileSync)("../config/commands-config.json", "utf8"));
    }
    static shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}
exports.Base = Base;
Base.config = JSON.parse((0, fs_1.readFileSync)("../config/config.json", "utf8"));
Base.commands = JSON.parse((0, fs_1.readFileSync)("../config/commands-config.json", "utf8"));
Base.lastCommands = JSON.parse((0, fs_1.readFileSync)("../data/last-commands-config.json", "utf8"));
Base.inviteURL = `https://discord.com/api/oauth2/authorize?client_id=` +
    Base.config.clientId +
    `&permissions=2433838096&scope=applications.commands%20bot`;
Base.knex = (0, knex_1.knex)({
    client: Base.config.databaseType,
    connection: {
        database: Base.config.databaseName,
        host: Base.config.databaseHost,
        password: Base.config.databasePassword,
        user: Base.config.databaseUsername,
    },
});
Base.client = new discord_js_1.Client({
    makeCache: (manager) => {
        if ("MessageManager" === manager.name) {
            return new MessageCollection_1.MessageCollection({ maxSize: 5 });
        }
        else if ([
            "GuildBanManager",
            "GuildEmojiManager",
            "PresenceManager",
            "ReactionManager",
            "ReactionUserManager",
            "StageInstanceManager",
            "ThreadManager",
            "ThreadMemberManager",
        ].includes(manager.name)) {
            return new discord_js_1.LimitedCollection({ maxSize: 0 });
        }
        else {
            return new discord_js_1.Collection();
        }
    },
    presence: {
        activities: [
            {
                type: "LISTENING",
                name: "/help",
            },
        ],
        status: "online",
    },
    intents: ["GUILDS", "GUILD_VOICE_STATES", "GUILD_MESSAGES", "GUILD_MEMBERS"],
    shards: "auto",
});
