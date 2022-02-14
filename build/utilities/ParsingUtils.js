"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsedMessage = exports.ParsedCommand = exports.Parsed = exports.ParsingUtils = void 0;
const Base_1 = require("./Base");
const QueueChannelTable_1 = require("./tables/QueueChannelTable");
const QueueGuildTable_1 = require("./tables/QueueGuildTable");
const AdminPermissionTable_1 = require("./tables/AdminPermissionTable");
class ParsingUtils {
    static async checkPermission(request) {
        try {
            const member = request.member;
            if (!member)
                return false;
            if (member
                .permissionsIn(request.channel)
                .has("ADMINISTRATOR"))
                return true;
            const roleIds = Array.from(member.roles.cache.keys());
            for await (const entry of await AdminPermissionTable_1.AdminPermissionTable.getMany(request.guild.id)) {
                if (roleIds.includes(entry.role_member_id) || member.id === entry.role_member_id)
                    return true;
            }
            const roles = member.roles.cache.values();
            for await (const role of roles) {
                if (this.regEx.test(role.name))
                    return true;
            }
        }
        catch (e) {
        }
        return false;
    }
}
exports.ParsingUtils = ParsingUtils;
ParsingUtils.regEx = RegExp(Base_1.Base.config.permissionsRegexp, "i");
class Parsed {
    constructor() {
        this.args = {};
    }
    async readArgs(conf) {
        if (this.missingArgs === undefined) {
            this.missingArgs = [];
        }
        else {
            return this.missingArgs;
        }
        await this.getStringParam(conf.commandNameLength);
        if (conf.hasChannel) {
            this.storedQueueChannels = await this.getStoredQueueChannels();
            const channels = await this.getChannels();
            await this.populateChannelParam(channels, conf.channelType);
            if (!this.args.channel) {
                const queues = [];
                for await (const storedQueueChannel of this.storedQueueChannels) {
                    const queueChannel = (await this.request.guild.channels
                        .fetch(storedQueueChannel.queue_channel_id)
                        .catch(() => null));
                    if (!queueChannel)
                        continue;
                    if (conf.channelType && !conf.channelType.includes(queueChannel.type))
                        continue;
                    queues.push(queueChannel);
                }
                if (queues.length === 1)
                    this.args.channel = queues[0];
            }
            if (!this.args.channel?.guild?.id) {
                const channelText = (conf.channelType?.includes("GUILD_TEXT") ? "**text** " : "") +
                    (conf.channelType?.includes("GUILD_VOICE") ||
                        conf.channelType?.includes("GUILD_STAGE_VOICE")
                        ? "**voice** "
                        : "") +
                    "channel";
                this.missingArgs.push(channelText);
            }
        }
        if (conf.hasRole) {
            await this.getRoleParam();
            if (!this.args.role)
                this.missingArgs.push("role");
        }
        if (conf.hasMember) {
            await this.getMemberParam();
            if (!this.args.member)
                this.missingArgs.push("member");
        }
        if (conf.numberArgs) {
            await this.getNumberParam();
            this.verifyNumber(conf.numberArgs.min, conf.numberArgs.max, conf.numberArgs.defaultValue);
        }
        if (conf.hasNumber && this.args.num === undefined)
            this.missingArgs.push("number");
        if (conf.hasText && !this.args.text)
            this.missingArgs.push("message");
        if (this.missingArgs.length) {
            await this.reply({
                content: "**ERROR**: Missing " +
                    this.missingArgs.join(" and ") +
                    " argument" +
                    (this.missingArgs.length > 1 ? "s" : "") +
                    ".",
                commandDisplay: "EPHEMERAL",
            }).catch(() => null);
        }
        return this.missingArgs;
    }
    async getStoredQueueChannels() {
        if (this.storedQueueChannels === undefined) {
            this.storedQueueChannels = await QueueChannelTable_1.QueueChannelTable.getFromGuild(this.request.guild.id);
        }
        return this.storedQueueChannels;
    }
    async getChannels() {
        if (this.channels === undefined) {
            this.channels = Array.from((await this.request.guild.channels.fetch())
                .filter((ch) => ["GUILD_VOICE", "GUILD_STAGE_VOICE", "GUILD_TEXT"].includes(ch.type))
                .values());
        }
        return this.channels;
    }
    async setup() {
        this.queueGuild = await QueueGuildTable_1.QueueGuildTable.get(this.request.guild.id);
        if (!this.queueGuild) {
            await QueueGuildTable_1.QueueGuildTable.store(this.request.guild);
            this.queueGuild = await QueueGuildTable_1.QueueGuildTable.get(this.request.guild.id);
        }
        this.hasPermission = await ParsingUtils.checkPermission(this.request);
    }
    verifyNumber(min, max, defaultValue) {
        if (this.args.num) {
            this.args.num = Math.max(Math.min(this.args.num, max), min);
        }
        else {
            this.args.num = defaultValue;
        }
    }
}
exports.Parsed = Parsed;
class ParsedCommand extends Parsed {
    constructor(command) {
        super();
        this.request = command;
    }
    async reply(options) {
        const mentions = options.allowMentions ? null : { parse: [] };
        const isEphemeral = options.commandDisplay === "EPHEMERAL";
        const message = {
            allowedMentions: mentions,
            content: options.content,
            embeds: options.embeds,
            ephemeral: isEphemeral,
            fetchReply: !isEphemeral,
        };
        if (this.request.replied) {
            return (await this.request.followUp(message));
        }
        else if (this.request.deferred) {
            return (await this.request.editReply(message));
        }
        else {
            return (await this.request.reply(message));
        }
    }
    async edit(options) {
        return (await this.request.editReply(options));
    }
    async deferReply() {
        await this.request.deferReply();
    }
    findArgs(_options, type, accumulator = []) {
        for (const option of _options) {
            if ((option.type === "SUB_COMMAND" || option.type === "SUB_COMMAND_GROUP") &&
                option.options?.length) {
                accumulator = this.findArgs(option.options, type, accumulator);
            }
            else if (option.type === type) {
                if (["CHANNEL"].includes(type)) {
                    accumulator.push(option.channel);
                }
                else if (["USER"].includes(type)) {
                    accumulator.push(option.member);
                }
                else if (["ROLE"].includes(type)) {
                    accumulator.push(option.role);
                }
                else {
                    accumulator.push(option.value);
                }
            }
        }
        return accumulator;
    }
    async populateChannelParam(channels, channelType) {
        let channel = this.findArgs(this.request.options.data, "CHANNEL")[0];
        if (!channel) {
            const channelId = this.args.text;
            if (channelId) {
                channel = (await this.getChannels()).find((ch) => ch.id === channelId);
                if (channel) {
                    this.args.text = this.args.rawStrings[1];
                }
            }
        }
        if (channel?.type &&
            ((channelType && !channelType.includes(channel.type)) ||
                !["GUILD_VOICE", "GUILD_STAGE_VOICE", "GUILD_TEXT"].includes(channel.type))) {
            channel = null;
        }
        this.args.channel = channel;
    }
    async getMemberParam() {
        this.args.member = this.findArgs(this.request.options.data, "USER")[0];
    }
    async getRoleParam() {
        this.args.role = this.findArgs(this.request.options.data, "ROLE")[0];
    }
    async getStringParam() {
        this.args.rawStrings = this.findArgs(this.request.options.data, "STRING");
        this.args.text = this.args.rawStrings[0];
    }
    async getNumberParam() {
        this.args.num = this.findArgs(this.request.options.data, "INTEGER")[0];
    }
}
exports.ParsedCommand = ParsedCommand;
class ParsedMessage extends Parsed {
    constructor(message) {
        super();
        this.request = message;
    }
    async reply(options) {
        const mentions = options.allowMentions ? null : { parse: [] };
        const message = {
            content: options.content,
            embeds: options.embeds,
            allowedMentions: mentions,
        };
        if (options.messageDisplay === "DM") {
            return (this.lastResponse = (await this.request.author.send(message)));
        }
        else if (options.messageDisplay !== "NONE") {
            return (this.lastResponse = (await this.request.reply(message)));
        }
    }
    async edit(options) {
        if (this.lastResponse && this.lastResponse.editable) {
            return (await this.lastResponse.edit(options));
        }
        else {
            return await this.reply(options);
        }
    }
    async deferReply() {
        this.lastResponse = await this.request.reply("Thinking...");
    }
    async populateChannelParam(channels, channelType) {
        if (this.request.mentions.channels.first()) {
            this.args.channel = this.request.mentions.channels.first();
            this.args.text = this.args.text.replace(`<#${this.args.channel.id}>`, "").trim();
        }
        else {
            if (channelType) {
                channels = channels.filter((ch) => channelType.includes(ch.type));
            }
            let channelName = this.args.text;
            while (channelName) {
                for (const channel of channels.values()) {
                    if (ParsedMessage.coll.compare(channelName, channel.name) === 0) {
                        this.args.channel = channel;
                        this.args.text = this.args.text.substring(channelName.length + 1);
                        break;
                    }
                }
                if (this.args.channel)
                    break;
                channelName = channelName.substring(0, channelName.lastIndexOf(" "));
            }
        }
    }
    async getMemberParam() {
        this.args.member = (await this.request.mentions.members).first();
        if (this.args.member) {
            this.args.text = this.args.text.replace(`<#${this.args.member.id}>`, "").trim();
        }
    }
    async getRoleParam() {
        this.args.role = (await this.request.mentions.roles).first();
        if (this.args.role) {
            this.args.text = this.args.text.replace(`<#${this.args.role.id}>`, "").trim();
        }
    }
    async getStringParam(commandNameLength) {
        this.args.text = this.request.content.substring(commandNameLength + 2).trim();
    }
    async getNumberParam() {
        this.args.num = +this.args.text.replace(/\D/g, "");
    }
}
exports.ParsedMessage = ParsedMessage;
ParsedMessage.coll = new Intl.Collator("en", { sensitivity: "base" });
