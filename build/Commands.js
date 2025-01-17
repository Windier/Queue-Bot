"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Commands = void 0;
const discord_js_1 = require("discord.js");
const MessagingUtils_1 = require("./utilities/MessagingUtils");
const DisplayChannelTable_1 = require("./utilities/tables/DisplayChannelTable");
const QueueChannelTable_1 = require("./utilities/tables/QueueChannelTable");
const QueueMemberTable_1 = require("./utilities/tables/QueueMemberTable");
const VoiceUtils_1 = require("./utilities/VoiceUtils");
const AdminPermissionTable_1 = require("./utilities/tables/AdminPermissionTable");
const BlackWhiteListTable_1 = require("./utilities/tables/BlackWhiteListTable");
const PriorityTable_1 = require("./utilities/tables/PriorityTable");
const QueueGuildTable_1 = require("./utilities/tables/QueueGuildTable");
const Base_1 = require("./utilities/Base");
const Validator_1 = require("./utilities/Validator");
class Commands {
    static async altPrefixGet(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 13 })).length)
            return;
        await parsed
            .reply({
            content: "**Alt Prefix** (`!`): " + (parsed.queueGuild.enable_alt_prefix ? "on" : "off"),
        })
            .catch(() => null);
    }
    static async altPrefixSet(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 13, hasText: true })).length)
            return;
        if (!["on", "off"].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `on` or `off`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else if ((parsed.queueGuild.enable_alt_prefix && parsed.args.text === "on") ||
            (!parsed.queueGuild.enable_alt_prefix && parsed.args.text === "off")) {
            await parsed
                .reply({
                content: `Alternative prefixes were already ${parsed.args.text}.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            await QueueGuildTable_1.QueueGuildTable.setAltPrefix(parsed.request.guild.id, parsed.args.text === "on");
            await parsed
                .reply({
                content: `Alternative prefixes have been turned ${parsed.args.text}.`,
            })
                .catch(() => null);
        }
    }
    static async autopullGet(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 12 })).length)
            return;
        let response = "**Autopull**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(queueChannel?.type))
                continue;
            response += `\`${queueChannel.name}\`: ${storedQueueChannel.auto_fill ? "on" : "off"}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async autopullSet(parsed) {
        if ((await parsed.readArgs({
            commandNameLength: 12,
            hasChannel: true,
            channelType: ["GUILD_VOICE", "GUILD_STAGE_VOICE"],
            hasText: true,
        })).length)
            return;
        if (!["on", "off"].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `on` or `off`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            const queueChannel = parsed.args.channel;
            if (!queueChannel?.id)
                return;
            const value = parsed.args.text === "off" ? 0 : 1;
            await QueueChannelTable_1.QueueChannelTable.setAutopull(queueChannel.id, value);
            await parsed
                .reply({
                content: `Set autopull of \`${queueChannel.name}\` to \`${parsed.args.text}\`.`,
            })
                .catch(() => null);
            MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        }
    }
    static async validateBWList(parsed, type, storedEntries) {
        let removedAny = false;
        for await (const entry of storedEntries) {
            let manager = entry.is_role ? parsed.request.guild.roles : parsed.request.guild.members;
            try {
                await manager.fetch(entry.role_member_id);
            }
            catch (e) {
                if ([403, 404].includes(e.httpStatus)) {
                    await BlackWhiteListTable_1.BlackWhiteListTable.unstore(type, entry.queue_channel_id, entry.role_member_id);
                    removedAny = true;
                }
            }
        }
        if (removedAny) {
            setTimeout(async () => await parsed
                .reply({
                content: `Removed 1 or more invalid members/roles from the ${type ? "white" : "black"}list.`,
            })
                .catch(() => null), 1000);
        }
    }
    static async genBWList(parsed, type) {
        const typeString = type ? "White" : "Black";
        const storedEntries = await BlackWhiteListTable_1.BlackWhiteListTable.getMany(type, parsed.args.channel.id);
        this.validateBWList(parsed, type, storedEntries).then();
        let response = `\n${typeString}list of \`${parsed.args.channel.name}\`: `;
        if (storedEntries?.length) {
            response += storedEntries
                .map((entry) => "<@" + (entry.is_role ? "&" : "") + entry.role_member_id + ">")
                .join(", ");
        }
        else {
            response += "Empty";
        }
        return response;
    }
    static async _bwAdd(parsed, type) {
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const member = parsed.args.member;
        const role = parsed.args.role;
        const id = member?.id || role?.id;
        if (!id)
            return;
        const name = member?.displayName || role?.name;
        const typeString = type ? "white" : "black";
        let response = "";
        if (await BlackWhiteListTable_1.BlackWhiteListTable.get(type, queueChannel.id, id)) {
            response += `\`${name}\` is already on the ${typeString}list of \`${queueChannel.name}\`.`;
        }
        else {
            await BlackWhiteListTable_1.BlackWhiteListTable.store(type, queueChannel.id, id, role != null);
            if (typeString === "black") {
                const members = role ? Array.from(role.members.values()) : [member];
                await this.kickFromQueue(parsed.queueGuild, queueChannel, members);
            }
            response += `Added \`${name}\` to the ${typeString}list of \`${queueChannel.name}\`.`;
        }
        response += await this.genBWList(parsed, type);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async bwAdd(parsed, isRole, isBlacklist) {
        if ((await parsed.readArgs({
            commandNameLength: 18,
            hasChannel: true,
            hasRole: isRole,
            hasMember: !isRole,
        })).length)
            return;
        this._bwAdd(parsed, isBlacklist ? 0 : 1).then();
    }
    static async _bwDelete(parsed, type) {
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const member = parsed.args.member;
        const role = parsed.args.role;
        const id = member?.id || role?.id;
        if (!id)
            return;
        const name = member?.displayName || role?.name;
        const typeString = type ? "white" : "black";
        let response = "";
        if (await BlackWhiteListTable_1.BlackWhiteListTable.get(type, queueChannel.id, id)) {
            await BlackWhiteListTable_1.BlackWhiteListTable.unstore(type, queueChannel.id, id);
            response += `Removed \`${name}\` from the ${typeString}list of \`${queueChannel.name}\`.`;
        }
        else {
            response += `\`${name}\` was not on the ${typeString}list of \`${queueChannel.name}\`.`;
        }
        response += await this.genBWList(parsed, type);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async bwDelete(parsed, isRole, isBlacklist) {
        if ((await parsed.readArgs({
            commandNameLength: 18,
            hasChannel: true,
            hasRole: isRole,
            hasMember: !isRole,
        })).length)
            return;
        this._bwDelete(parsed, isBlacklist ? 0 : 1).then();
    }
    static async _bwList(parsed, type) {
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const response = await this.genBWList(parsed, type);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async bwList(parsed, isBlacklist) {
        if ((await parsed.readArgs({ commandNameLength: 14, hasChannel: true })).length)
            return;
        this._bwList(parsed, isBlacklist ? 0 : 1).then();
    }
    static async bwClear(parsed, isBlacklist) {
        if ((await parsed.readArgs({ commandNameLength: 15, hasChannel: true })).length)
            return;
        const queueChannel = parsed.args.channel;
        await BlackWhiteListTable_1.BlackWhiteListTable.unstore(isBlacklist ? 0 : 1, queueChannel.id);
        const typeString = isBlacklist ? "black" : "white";
        await parsed
            .reply({
            content: `Cleared the ${typeString}list of \`${queueChannel.name}\`.`,
        })
            .catch(() => null);
    }
    static async buttonGet(parsed) {
        await parsed.readArgs({ commandNameLength: 10 });
        let response = "**Buttons**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!["GUILD_TEXT"].includes(queueChannel?.type))
                continue;
            response += `\`${queueChannel.name}\`: ${storedQueueChannel.hide_button ? "off" : "on"}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async buttonSet(parsed) {
        await parsed.readArgs({
            commandNameLength: 10,
            hasChannel: true,
            channelType: ["GUILD_TEXT"],
            hasText: true,
        });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        if (!["on", "off"].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `on` or `off`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            await QueueChannelTable_1.QueueChannelTable.setHideButton(queueChannel.id, parsed.args.text === "off");
            await parsed
                .reply({
                content: `Set button of \`${queueChannel.name}\` to \`${parsed.args.text}\`.`,
            })
                .catch(() => null);
            MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        }
    }
    static async clear(parsed) {
        await parsed.readArgs({ commandNameLength: 5, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        await QueueMemberTable_1.QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id);
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        await parsed
            .reply({
            content: `\`${queueChannel.name}\` queue cleared.`,
        })
            .catch(() => null);
    }
    static async colorGet(parsed) {
        await parsed.readArgs({ commandNameLength: 9 });
        let response = "**Colors**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!queueChannel)
                continue;
            response += `\`${queueChannel.name}\`: ${storedQueueChannel.color}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async colorSet(parsed) {
        await parsed.readArgs({ commandNameLength: 9, hasChannel: true, hasText: true });
        if (![
            "default",
            "white",
            "aqua",
            "green",
            "blue",
            "yellow",
            "purple",
            "luminous_vivid_pink",
            "fuchsia",
            "gold",
            "orange",
            "red",
            "grey",
            "darker_grey",
            "navy",
            "dark_aqua",
            "dark_green",
            "dark_blue",
            "dark_purple",
            "dark_vivid_pink",
            "dark_gold",
            "dark_orange",
            "dark_red",
            "random",
        ].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Invalid color.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
            return;
        }
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        await QueueChannelTable_1.QueueChannelTable.setColor(queueChannel, parsed.args.text.toUpperCase());
        await parsed
            .reply({
            content: `Set color of \`${queueChannel.name}\` to \`${parsed.args.text}\`.`,
        })
            .catch(() => null);
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
    }
    static async display(parsed, channel) {
        await parsed.readArgs({ commandNameLength: 7, hasChannel: true });
        const queueChannel = channel || parsed.args.channel;
        if (!queueChannel)
            return;
        const author = parsed.request.member;
        if (!author?.id)
            return;
        const displayChannel = parsed.request.channel;
        const displayPermission = displayChannel.permissionsFor(displayChannel.guild.me);
        if (displayPermission.has("SEND_MESSAGES") && displayPermission.has("EMBED_LINKS")) {
            const embeds = await MessagingUtils_1.MessagingUtils.generateEmbed(queueChannel);
            await DisplayChannelTable_1.DisplayChannelTable.unstore(queueChannel.id, displayChannel.id);
            await DisplayChannelTable_1.DisplayChannelTable.store(queueChannel, displayChannel, embeds);
            if (!channel) {
                await parsed
                    .reply({
                    content: "Displayed.",
                    messageDisplay: "NONE",
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
            }
        }
        else {
            await parsed
                .reply({
                content: `I don't have permission to write messages and embeds in \`${displayChannel.name}\`.`,
                messageDisplay: "DM",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id).catch(() => null);
        if (storedQueueChannel && !(storedQueueChannel?.role_id || parsed.queueGuild.disable_roles)) {
            await QueueChannelTable_1.QueueChannelTable.createQueueRole(parsed, queueChannel, storedQueueChannel.color);
        }
        Validator_1.Validator.validateGuild(queueChannel.guild).catch(() => null);
    }
    static async enqueue(parsed) {
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const member = parsed.args.member;
        const role = parsed.args.role;
        if (queueChannel.type !== "GUILD_TEXT") {
            if (member?.voice?.channel?.id !== queueChannel.id || role) {
                await parsed
                    .reply({
                    content: `**ERROR**: \`/enqueue ${queueChannel.name}\` can only be used on users who are already in the \`${queueChannel.name}\` voice channel.`,
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
                return;
            }
        }
        const customMessage = parsed.args.text?.substring(0, 128);
        if (member?.id) {
            try {
                await QueueMemberTable_1.QueueMemberTable.store(queueChannel, member, customMessage, true);
                await parsed
                    .reply({
                    content: `Added <@${member.id}> to \`${queueChannel.name}\`.`,
                })
                    .catch(() => null);
                MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
            }
            catch (e) {
                if (e.author === "Queue Bot") {
                    await parsed
                        .reply({
                        content: "**ERROR**: " + e.message,
                        commandDisplay: "EPHEMERAL",
                    })
                        .catch(() => null);
                }
                else {
                    throw e;
                }
            }
        }
        else if (role?.id) {
            let errorAccumulator = "";
            for await (const member of role.members.values()) {
                try {
                    await QueueMemberTable_1.QueueMemberTable.store(queueChannel, member, customMessage, true);
                }
                catch (e) {
                    if (e.author === "Queue Bot") {
                        errorAccumulator += e.message;
                    }
                    else {
                        throw e;
                    }
                }
            }
            const errorText = errorAccumulator
                ? "However, failed to add 1 or more members:\n" + errorAccumulator
                : "";
            await parsed
                .reply({
                content: `Added <@&${role.id}> to \`${queueChannel.name}\`.` + errorText,
            })
                .catch(() => null);
            MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        }
    }
    static async enqueueUser(parsed) {
        await parsed.readArgs({ commandNameLength: 12, hasChannel: true, hasMember: true });
        await this.enqueue(parsed);
    }
    static async enqueueRole(parsed) {
        await parsed.readArgs({ commandNameLength: 12, hasChannel: true, hasRole: true });
        await this.enqueue(parsed);
    }
    static async graceperiodGet(parsed) {
        await parsed.readArgs({ commandNameLength: 15 });
        let response = "**Grace Periods**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!queueChannel)
                continue;
            const timeString = MessagingUtils_1.MessagingUtils.getGracePeriodString(storedQueueChannel.grace_period);
            response += `\`${queueChannel.name}\`: ${timeString || "0 seconds"}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async graceperiodSet(parsed) {
        await parsed.readArgs({
            commandNameLength: 15,
            hasChannel: true,
            hasNumber: true,
            numberArgs: { min: 0, max: 6000, defaultValue: null },
        });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        await QueueChannelTable_1.QueueChannelTable.setGraceperiod(queueChannel.id, parsed.args.num);
        const timeString = MessagingUtils_1.MessagingUtils.getGracePeriodString(parsed.args.num);
        await parsed
            .reply({
            content: `Set grace period of \`${queueChannel.name}\` to \`${timeString || "0 seconds"}\`.`,
        })
            .catch(() => null);
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
    }
    static async headerGet(parsed) {
        await parsed.readArgs({ commandNameLength: 10 });
        let response = "**Headers**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!queueChannel)
                continue;
            response += `\`${queueChannel.name}\`: ${storedQueueChannel.header || "none"}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async headerSet(parsed) {
        await parsed.readArgs({ commandNameLength: 10, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const message = parsed.args.text || "";
        await QueueChannelTable_1.QueueChannelTable.setHeader(queueChannel.id, message);
        await parsed
            .reply({
            content: `Updated \`${queueChannel.name}\` header.`,
        })
            .catch(() => null);
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
    }
    static async help(parsed) {
        await parsed.readArgs({ commandNameLength: 4 });
        const alt = parsed.queueGuild.enable_alt_prefix;
        const response = {
            title: "Commands for Everyone",
            fields: [
                {
                    name: "How to join queues",
                    value: "**TEXT**: Click the button under a queue display or use `/join` & `/leave`.\n" +
                        "**VOICE**: Join the matching voice channel.",
                },
                {
                    name: "`/join`" + (alt ? " or `!join`" : ""),
                    value: "Join a text queue / Update queue message after joining",
                },
                {
                    name: "`/leave`" + (alt ? " or `!leave`" : ""),
                    value: "Leave a queue",
                },
                {
                    name: "`/myqueues`" + (alt ? " or `!myqueues`" : ""),
                    value: "Show my queues",
                },
                {
                    name: "`/help setup`" + (alt ? " or `!help setup`" : ""),
                    value: "Setup & admin commands",
                },
            ],
        };
        await parsed
            .reply({
            embeds: [response],
            messageDisplay: "DM",
            commandDisplay: "EPHEMERAL",
        })
            .catch(() => null);
    }
    static async helpQueue(parsed) {
        await parsed.readArgs({ commandNameLength: 10 });
        const response = {
            author: { name: "Privileged Commands" },
            title: "Queue Management",
            fields: [
                {
                    name: "`/altprefix`",
                    value: "Enable or disable alternate prefix `!`",
                },
                {
                    name: "`/autopull`",
                    value: "Get / Set automatic pull from a voice queue",
                },
                {
                    name: "`/blacklist add user` & `/blacklist add role`",
                    value: "Blacklist a user or role",
                },
                {
                    name: "`/blacklist delete user` & `/blacklist delete role`",
                    value: "Un-blacklist a user or role",
                },
                {
                    name: "`/blacklist list`",
                    value: "Display a blacklist",
                },
                {
                    name: "`/blacklist clear`",
                    value: "Clear a blacklist",
                },
                {
                    name: "`/button`",
                    value: 'Get / Set whether a "Join / Leave" button appears under a text queue display',
                },
                {
                    name: "`/clear`",
                    value: "Clear a queue",
                },
                {
                    name: "`/color`",
                    value: "Get / Set color of queue displays",
                },
                {
                    name: "`/display`",
                    value: "Display a queue",
                },
                {
                    name: "`/enqueue user` & `/enqueue role`",
                    value: "Add a specified user or role to a queue",
                },
                {
                    name: "`/graceperiod`",
                    value: "Get / Set how long users can leave a queue before losing their position",
                },
                {
                    name: "`/header`",
                    value: "Get / Set a header on display messages",
                },
                {
                    name: "`/kick`",
                    value: "Kick a user from a queue",
                },
                {
                    name: "`/kick all`",
                    value: "Kick a user from all queue",
                },
                {
                    name: "`/lock`",
                    value: "Lock or unlock a queue. Locked queues can still be left",
                },
                {
                    name: "`/mentions`",
                    value: "Get / Set whether users are displayed as mentions (on), or normal text (off). Normal text helps avoid the @invalid-user issue",
                },
                {
                    name: "`/next`",
                    value: "Pull from a text queue",
                },
                {
                    name: "`/pullnum`",
                    value: "Get / Set # of users to pull when manually pulling from a voice queue",
                },
                {
                    name: "`/queues add`",
                    value: "Create a queue",
                },
                {
                    name: "`/queues delete`",
                    value: "Delete a queue",
                },
                {
                    name: "`/queues list`",
                    value: "List queues",
                },
                {
                    name: "`/roles`",
                    value: "Enable or disable whether members in a queue are given an `In Queue: ...` role",
                },
                {
                    name: "`/shuffle`",
                    value: "Shuffle a queue",
                },
                {
                    name: "`/size`",
                    value: "Get / Set the size limits of queues",
                },
                {
                    name: "`/start`",
                    value: "Add the bot to a voice queue",
                },
                {
                    name: "`/to-me`",
                    value: "Pull user(s) from a voice queue to you and display their name(s)",
                },
                {
                    name: "`/whitelist add user` & `/whitelist add role`",
                    value: "whitelist a user or role",
                },
                {
                    name: "`/whitelist delete user` & `/whitelist delete role`",
                    value: "Un-whitelist a user or role",
                },
                {
                    name: "`/whitelist list`",
                    value: "Display a whitelist",
                },
                {
                    name: "`/whitelist clear`",
                    value: "Clear a whitelist",
                },
            ],
        };
        const content = parsed.hasPermission
            ? "✅ You can use privileged commands."
            : "❌ You can **NOT** use privileged commands.";
        await parsed
            .reply({
            content: content,
            embeds: [response],
            messageDisplay: "DM",
            commandDisplay: "EPHEMERAL",
        })
            .catch(() => null);
    }
    static async helpBot(parsed) {
        await parsed.readArgs({ commandNameLength: 8 });
        const response = {
            author: { name: "Privileged Commands" },
            title: "Bot Management",
            fields: [
                {
                    name: "`/mode`",
                    value: "Set display mode",
                },
                {
                    name: "`/permission add user` & `/permission add role`",
                    value: "Grant bot permission to a user or role",
                },
                {
                    name: "`/permission delete user` & `/permission delete role`",
                    value: "Revoke bot permission from a user or role",
                },
                {
                    name: "`/permission list`",
                    value: "List users & roles with bot permission",
                },
                {
                    name: "`/permission clear`",
                    value: "Clear users & roles with bot permission",
                },
            ],
        };
        const content = parsed.hasPermission
            ? "✅ You can use privileged commands."
            : "❌ You can **NOT** use privileged commands.";
        await parsed
            .reply({
            content: content,
            embeds: [response],
            messageDisplay: "DM",
            commandDisplay: "EPHEMERAL",
        })
            .catch(() => null);
    }
    static async helpSetup(parsed) {
        await parsed.readArgs({ commandNameLength: 10 });
        const response = {
            author: { name: "Privileged Commands" },
            title: "Setup",
            description: "By default, privileged commands can only be used by the server owner, admins, and users with any " +
                "of the following roles: `mod`, `moderator`, `admin`, `administrator`. " +
                "Users or roles can be granted permission to use privileged commands with `/permission add`.",
            fields: [
                {
                    name: "Step 1. Create a queue",
                    value: "`/queues add`",
                },
                {
                    name: "Step 2. Join queues",
                    value: "**TEXT**: Click the button under a queue display or use `/join` & `/leave`.\n" +
                        "**VOICE**: Join the matching voice channel.",
                },
                {
                    name: "Step 3. Pull users from queues",
                    value: "**TEXT**: Admins can pull users from text queues with `/next`.\n" +
                        "**VOICE**: Pulling users from voice queues requires 2 steps:\n" +
                        "1. `/start` makes the bot join a voice queue.\n" +
                        "2. Drag the bot to a new (non-queue) voice channel, then disconnect the bot.\n" +
                        "If the new channel has a user limit (`/size`), " +
                        "the bot will automatically pull users from the queue to keep the new channel full.\n" +
                        "If the new channel does not have a user limit, " +
                        "drag the bot to a new (non-queue) voice channel, each time you want to pull " +
                        "a user from the queue (the bot will swap with them). " +
                        "You can customize how many users the bot will pull at a time with `/pullnum`.",
                },
                {
                    name: "Step 4. Other Commands",
                    value: "There are more commands for customizing bot behavior.\n" +
                        "View the queue management commands with `/help queues`.\n" +
                        "View the bot management commands with `/help bot`.",
                },
                {
                    name: "Support Server",
                    value: "[Support Server link](https://discord.com/invite/RbmfnP3)",
                },
                {
                    name: "Support the Bot :heart:",
                    value: "Hosting isn't free and development takes lots of time.\n" +
                        "1. [Leave a review on top.gg](https://top.gg/bot/679018301543677959).\n" +
                        "2. [Buy me a coffee](https://www.buymeacoffee.com/Arroww).",
                },
            ],
        };
        const content = parsed.hasPermission
            ? "✅ You can use privileged commands."
            : "❌ You can **NOT** use privileged commands.";
        await parsed
            .reply({
            content: content,
            embeds: [response],
            messageDisplay: "DM",
            commandDisplay: "EPHEMERAL",
        })
            .catch(() => null);
    }
    static async join(parsed) {
        await parsed.readArgs({ commandNameLength: 4, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const author = parsed.request.member;
        if (!author?.id)
            return;
        if (queueChannel.type !== "GUILD_TEXT") {
            if (author.voice?.channel?.id !== queueChannel.id) {
                await parsed
                    .reply({
                    content: `**ERROR**: \`/join ${queueChannel.name}\` can only be used while you are in the \`${queueChannel.name}\` voice channel.`,
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
                return;
            }
        }
        const customMessage = parsed.args.text?.substring(0, 128);
        try {
            await QueueMemberTable_1.QueueMemberTable.store(queueChannel, author, customMessage);
            await parsed
                .reply({
                content: `You joined \`${queueChannel.name}\`.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        catch (e) {
            if (e.author === "Queue Bot") {
                await parsed
                    .reply({
                    content: "**ERROR**: " + e.message,
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
                return;
            }
        }
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
    }
    static async kickFromQueue(queueGuild, queueChannel, members) {
        if (["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(queueChannel.type)) {
            for await (const member of members) {
                await member?.voice?.disconnect().catch(() => null);
            }
        }
        else {
            await QueueMemberTable_1.QueueMemberTable.unstore(queueGuild.guild_id, queueChannel.id, members.map((m) => m.id));
        }
    }
    static async kick(parsed) {
        await parsed.readArgs({ commandNameLength: 4, hasChannel: true, hasMember: true });
        const member = parsed.args.member;
        const channel = parsed.args.channel;
        if (!member?.id || !channel?.id)
            return;
        await this.kickFromQueue(parsed.queueGuild, channel, [member]);
        await parsed
            .reply({
            content: `Kicked <@${member.id}> from \`${channel.name}\` queue.`,
        })
            .catch(() => null);
    }
    static async kickAll(parsed) {
        await parsed.readArgs({ commandNameLength: 7, hasMember: true });
        const member = parsed.args.member;
        if (!member?.id)
            return;
        const channels = [];
        const storedChannelIds = (await QueueChannelTable_1.QueueChannelTable.getFromGuild(member.guild.id)).map((ch) => ch.queue_channel_id);
        const storedEntries = await QueueMemberTable_1.QueueMemberTable.getFromChannels(storedChannelIds, member.id);
        for await (const entry of storedEntries) {
            const queueChannel = (await parsed.getChannels()).find((ch) => ch.id === entry.channel_id);
            channels.push(queueChannel);
            await this.kickFromQueue(parsed.queueGuild, queueChannel, [member]);
        }
        await parsed
            .reply({
            content: `Kicked <@${member.id}> from ` +
                channels.map((ch) => `\`${ch.name}\``).join(", ") +
                " queues.",
        })
            .catch(() => null);
    }
    static async leave(parsed) {
        await parsed.readArgs({ commandNameLength: 5, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const author = parsed.request.member;
        if (!author?.id)
            return;
        const storedMember = await QueueMemberTable_1.QueueMemberTable.get(queueChannel.id, author.id);
        if (storedMember) {
            await QueueMemberTable_1.QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id, [author.id]);
            await parsed
                .reply({
                content: `You left \`${queueChannel.name}\`.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            await parsed
                .reply({
                content: `You were not in \`${queueChannel.name}\`.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
    }
    static async lockGet(parsed) {
        await parsed.readArgs({ commandNameLength: 8, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id).catch(() => null);
        if (!storedQueueChannel)
            return;
        await parsed
            .reply({
            content: `\`${queueChannel.name}\` is **${storedQueueChannel.is_locked ? "locked" : "unlocked"}**.`,
        })
            .catch(() => null);
    }
    static async lockSet(parsed) {
        await parsed.readArgs({ commandNameLength: 8, hasChannel: true, hasText: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id).catch(() => null);
        if (!storedQueueChannel)
            return;
        if (!["lock", "unlock"].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `lock` or `unlock`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else if ((storedQueueChannel.is_locked && parsed.args.text === "lock") ||
            (!storedQueueChannel.is_locked && parsed.args.text === "unlock")) {
            await parsed
                .reply({
                content: `Queue was already ${parsed.args.text}ed.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            await QueueChannelTable_1.QueueChannelTable.setLock(queueChannel.id, parsed.args.text === "lock");
            if (parsed.args.text === "unlock" && queueChannel.type === "GUILD_VOICE") {
                queueChannel.members.each((member) => QueueMemberTable_1.QueueMemberTable.store(queueChannel, member));
            }
            await parsed
                .reply({
                content: `${parsed.args.text === "lock" ? "Locked " : "Unlocked "} \`${queueChannel.name}\`.`,
            })
                .catch(() => null);
            MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        }
    }
    static async mentionsGet(parsed) {
        await parsed.readArgs({ commandNameLength: 12 });
        await parsed
            .reply({
            content: "**Mentions**: " + (parsed.queueGuild.disable_mentions ? "off" : "on"),
        })
            .catch(() => null);
    }
    static async mentionsSet(parsed) {
        await parsed.readArgs({ commandNameLength: 12, hasText: true });
        if (!["on", "off"].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `on` or `off`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else if ((parsed.queueGuild.disable_mentions && parsed.args.text === "off") ||
            (!parsed.queueGuild.disable_mentions && parsed.args.text === "on")) {
            await parsed
                .reply({
                content: `Mentions were already ${parsed.args.text}.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            const guild = parsed.request.guild;
            const disableMentions = parsed.args.text !== "on";
            await QueueGuildTable_1.QueueGuildTable.setDisableMentions(guild.id, disableMentions);
            await parsed
                .reply({
                content: `Set mentions to \`${parsed.args.text}\`.`,
            })
                .catch(() => null);
            const storedQueueChannels = await QueueChannelTable_1.QueueChannelTable.getFromGuild(guild.id);
            for await (const storedQueueChannel of storedQueueChannels) {
                const queueChannel = (await parsed.getChannels()).find((ch) => ch.id === storedQueueChannel.queue_channel_id);
                MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
            }
        }
    }
    static async modeGet(parsed) {
        await parsed.readArgs({ commandNameLength: 8 });
        let response = "**Messaging Mode**:\n";
        switch (parsed.queueGuild.msg_mode) {
            case 1:
                response += "`1`. Old display messages are edited.";
                break;
            case 2:
                response += "`2`. New display messages are sent and old ones are deleted.";
                break;
            case 3:
                response += "`3`. New display messages are sent.";
                break;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async modeSet(parsed) {
        await parsed.readArgs({
            commandNameLength: 8,
            hasNumber: true,
            numberArgs: { min: 1, max: 3, defaultValue: 1 },
        });
        if (![1, 2, 3].includes(parsed.args.num)) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `1`, `2`, or `3`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
            return;
        }
        await QueueGuildTable_1.QueueGuildTable.setMessageMode(parsed.request.guild.id, parsed.args.num);
        await parsed
            .reply({
            content: `Set messaging mode to \`${parsed.args.num}\`.`,
        })
            .catch(() => null);
    }
    static async myqueues(parsed) {
        await parsed.readArgs({ commandNameLength: 8 });
        const author = parsed.request.member;
        if (!author?.id)
            return;
        const storedChannelIds = (await QueueChannelTable_1.QueueChannelTable.getFromGuild(author.guild.id)).map((ch) => ch.queue_channel_id);
        const storedEntries = (await QueueMemberTable_1.QueueMemberTable.getFromChannels(storedChannelIds, author.id)).slice(0, 25);
        if (storedEntries?.length < 1) {
            await parsed
                .reply({
                content: `You are in no queues.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            const embed = new discord_js_1.MessageEmbed();
            embed.setTitle(`${author.displayName}'s queues`);
            for await (const entry of storedEntries) {
                const queueChannel = (await parsed.getChannels()).find((ch) => ch.id === entry.channel_id);
                if (!queueChannel)
                    continue;
                const memberIds = (await QueueMemberTable_1.QueueMemberTable.getNext(queueChannel)).map((member) => member.member_id);
                embed.addField(queueChannel.name, `${memberIds.indexOf(author.id) + 1} <@${author.id}>` +
                    (entry.personal_message ? ` -- ${entry.personal_message}` : ""));
            }
            await parsed
                .reply({
                embeds: [embed],
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
    }
    static async next(parsed) {
        await parsed.readArgs({
            commandNameLength: 4,
            hasChannel: true,
            numberArgs: { min: 1, max: 99, defaultValue: null },
        });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const storedQueueChannel = parsed.storedQueueChannels.find((ch) => ch.queue_channel_id === queueChannel.id);
        if (!storedQueueChannel)
            return;
        const targetChannel = (await queueChannel.guild.channels
            .fetch(storedQueueChannel.target_channel_id)
            .catch(() => null));
        await this.pullMembers(parsed, targetChannel);
    }
    static async pullMembers(parsed, targetChannel) {
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const storedQueueChannel = parsed.storedQueueChannels.find((ch) => ch.queue_channel_id === queueChannel.id);
        if (!storedQueueChannel)
            return;
        try {
            await parsed.deferReply();
        }
        catch (e) {
            return;
        }
        const amount = parsed.args.num || storedQueueChannel.pull_num || 1;
        let queueMembers = await QueueMemberTable_1.QueueMemberTable.getNext(queueChannel, amount);
        if (queueMembers.length > 0) {
            if (["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(queueChannel.type)) {
                if (targetChannel) {
                    for await (const queueMember of queueMembers) {
                        const member = await QueueMemberTable_1.QueueMemberTable.getMemberFromQueueMember(queueChannel, queueMember);
                        if (!member)
                            continue;
                        member.voice.setChannel(targetChannel).catch(() => null);
                    }
                }
                else {
                    await parsed
                        .edit({
                        content: "**ERROR**: No target channel. Set a target channel by sending `/start` then dragging the bot to the target channel.",
                        commandDisplay: "EPHEMERAL",
                    })
                        .catch(() => null);
                    return;
                }
            }
            else {
                for await (const queueMember of queueMembers) {
                    const member = await QueueMemberTable_1.QueueMemberTable.getMemberFromQueueMember(queueChannel, queueMember);
                    if (!member)
                        continue;
                    await member
                        .send(`You were just pulled from the \`${queueChannel.name}\` queue ` +
                        `in \`${queueChannel.guild.name}\`. Thanks for waiting!`)
                        .catch(() => null);
                }
            }
            await parsed
                .edit({
                content: `Pulled ` +
                    queueMembers.map((member) => `<@${member.member_id}>`).join(", ") +
                    ` from \`${queueChannel.name}\`.`,
            })
                .catch(() => null);
            await QueueMemberTable_1.QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id, queueMembers.map((member) => member.member_id));
            MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        }
        else {
            await parsed
                .edit({
                content: `\`${queueChannel.name}\` is empty.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
    }
    static async genPermissionList(parsed) {
        const perms = await AdminPermissionTable_1.AdminPermissionTable.getMany(parsed.request.guild.id);
        let response = "\nRoles and users with bot permission: ";
        if (perms?.length) {
            response += perms
                .map((status) => "<@" + (status.is_role ? "&" : "") + status.role_member_id + ">")
                .join(", ");
        }
        else {
            response += "Empty";
        }
        return response;
    }
    static async permissionAdd(parsed) {
        const member = parsed.args.member;
        const role = parsed.args.role;
        const id = member?.id || role?.id;
        if (!id)
            return;
        const name = member?.displayName || role?.name;
        let response = "";
        if (await AdminPermissionTable_1.AdminPermissionTable.get(parsed.request.guild.id, id)) {
            response += `\`${name}\` already has bot permission.`;
        }
        else {
            await AdminPermissionTable_1.AdminPermissionTable.store(parsed.request.guild.id, id, role != null);
            response += `Added bot permission for \`${name}\`.`;
        }
        response += await this.genPermissionList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async permissionAddUser(parsed) {
        await parsed.readArgs({ commandNameLength: 19, hasMember: true });
        await this.permissionAdd(parsed);
    }
    static async permissionAddRole(parsed) {
        await parsed.readArgs({ commandNameLength: 19, hasRole: true });
        await this.permissionAdd(parsed);
    }
    static async permissionDelete(parsed) {
        const member = parsed.args.member;
        const role = parsed.args.role;
        const id = member?.id || role?.id;
        if (!id)
            return;
        const name = member?.displayName || role?.name;
        let response = "";
        if (await AdminPermissionTable_1.AdminPermissionTable.get(parsed.request.guild.id, id)) {
            await AdminPermissionTable_1.AdminPermissionTable.unstore(parsed.request.guild.id, id);
            response += `Removed bot permission for \`${name}\`.`;
        }
        else {
            response += `\`${name}\` did not have bot permission.`;
        }
        response += await this.genPermissionList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async permissionDeleteUser(parsed) {
        await parsed.readArgs({ commandNameLength: 22, hasMember: true });
        await this.permissionDelete(parsed);
    }
    static async permissionDeleteRole(parsed) {
        await parsed.readArgs({ commandNameLength: 22, hasRole: true });
        await this.permissionDelete(parsed);
    }
    static async permissionList(parsed) {
        await parsed.readArgs({ commandNameLength: 20 });
        const response = await this.genPermissionList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async permissionClear(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 21 })).length)
            return;
        await AdminPermissionTable_1.AdminPermissionTable.unstore(parsed.request.guildId);
        await parsed
            .reply({
            content: `Cleared the bot permissions list.`,
        })
            .catch(() => null);
    }
    static async validatePriorityList(parsed, storedEntries) {
        let removedAny = false;
        for await (const entry of storedEntries) {
            if (entry.is_role)
                continue;
            let manager = entry.is_role ? parsed.request.guild.roles : parsed.request.guild.members;
            try {
                await manager.fetch(entry.role_member_id);
            }
            catch (e) {
                if ([403, 404].includes(e.httpStatus)) {
                    await PriorityTable_1.PriorityTable.unstore(parsed.queueGuild.guild_id, entry.role_member_id);
                    removedAny = true;
                }
            }
        }
        if (removedAny) {
            setTimeout(async () => await parsed
                .reply({
                content: `Removed 1 or more invalid members/roles from the priority list.`,
            })
                .catch(() => null), 1000);
        }
    }
    static async genPriorityList(parsed) {
        const storedEntries = await PriorityTable_1.PriorityTable.getMany(parsed.queueGuild.guild_id);
        this.validatePriorityList(parsed, storedEntries).then();
        let response = "\nPriority list: ";
        if (storedEntries?.length) {
            response += storedEntries
                .map((entry) => "<@" + (entry.is_role ? "&" : "") + entry.role_member_id + ">")
                .join(", ");
        }
        else {
            response += "Empty";
        }
        return response;
    }
    static async updatePriorities(parsed) {
        const guild = parsed.request.guild;
        const priorityIds = (await PriorityTable_1.PriorityTable.getMany(guild.id)).map((entry) => entry.role_member_id);
        for await (const storedChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.getChannels()).find((ch) => ch.id === storedChannel.queue_channel_id);
            if (!queueChannel)
                continue;
            const storedMembers = await QueueMemberTable_1.QueueMemberTable.getFromQueue(queueChannel);
            for await (const storedMember of storedMembers) {
                const queueMember = await QueueMemberTable_1.QueueMemberTable.getMemberFromQueueMember(queueChannel, storedMember);
                if (!queueMember)
                    continue;
                const roleIds = queueMember.roles.cache.keys();
                if ([queueMember.id, ...roleIds].some((id) => priorityIds.includes(id))) {
                    QueueMemberTable_1.QueueMemberTable.setPriority(queueChannel.id, queueMember.id, true).then();
                }
                else {
                    QueueMemberTable_1.QueueMemberTable.setPriority(queueChannel.id, queueMember.id, false).then();
                }
            }
            MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        }
    }
    static async priorityAdd(parsed) {
        const member = parsed.args.member;
        const role = parsed.args.role;
        const id = member?.id || role?.id;
        if (!id)
            return;
        const name = member?.displayName || role?.name;
        const guildId = parsed.request.guild.id;
        let response = "";
        if (await PriorityTable_1.PriorityTable.get(guildId, id)) {
            response += `\`${name}\` is already on the priority list.`;
        }
        else {
            await PriorityTable_1.PriorityTable.store(guildId, id, role != null);
            response += `Added \`${name}\` to the priority list.`;
            this.updatePriorities(parsed).then();
        }
        response += await this.genPriorityList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async priorityAddUser(parsed) {
        await parsed.readArgs({ commandNameLength: 17, hasMember: true });
        await this.priorityAdd(parsed);
    }
    static async priorityAddRole(parsed) {
        await parsed.readArgs({ commandNameLength: 17, hasRole: true });
        await this.priorityAdd(parsed);
    }
    static async priorityDelete(parsed) {
        const member = parsed.args.member;
        const role = parsed.args.role;
        const id = member?.id || role?.id;
        if (!id)
            return;
        const name = member?.displayName || role?.name;
        const guildId = parsed.request.guild.id;
        let response = "";
        if (await PriorityTable_1.PriorityTable.get(guildId, id)) {
            await PriorityTable_1.PriorityTable.unstore(guildId, id);
            response += `Removed \`${name}\` from the priority list.`;
            this.updatePriorities(parsed).then();
        }
        else {
            response += `\`${name}\` was not on the priority list.`;
        }
        response += await this.genPriorityList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async priorityDeleteUser(parsed) {
        await parsed.readArgs({ commandNameLength: 17, hasMember: true });
        await this.priorityDelete(parsed);
    }
    static async priorityDeleteRole(parsed) {
        await parsed.readArgs({ commandNameLength: 17, hasRole: true });
        await this.priorityDelete(parsed);
    }
    static async priorityList(parsed) {
        await parsed.readArgs({ commandNameLength: 13 });
        const response = await this.genPriorityList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async priorityClear(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 22 })).length)
            return;
        await PriorityTable_1.PriorityTable.unstore(parsed.request.guildId);
        await parsed
            .reply({
            content: `Cleared the priority list.`,
        })
            .catch(() => null);
    }
    static async pullnumGet(parsed) {
        await parsed.readArgs({ commandNameLength: 11 });
        let response = "**Pull nums**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!queueChannel)
                continue;
            response += `\`${queueChannel.name}\`: ${storedQueueChannel.pull_num}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async pullnumSet(parsed) {
        await parsed.readArgs({
            commandNameLength: 11,
            hasChannel: true,
            hasNumber: true,
            numberArgs: { min: 1, max: 99, defaultValue: 1 },
        });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const value = parsed.args.num;
        await QueueChannelTable_1.QueueChannelTable.setPullnum(queueChannel.id, value);
        await parsed
            .reply({
            content: `Set pull number of \`${queueChannel.name}\` to \`${value}\`.`,
        })
            .catch(() => null);
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
    }
    static async genQueuesList(parsed) {
        const storedChannels = await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(parsed.request.guild);
        if (storedChannels?.length) {
            return "\nQueues: " + storedChannels.map((ch) => `\`${ch.name}\``).join(", ");
        }
        else {
            return "\nNo queue channels set. Set a new queue channel using `/queues add`.";
        }
    }
    static async storeQueue(parsed, channel, size) {
        await QueueChannelTable_1.QueueChannelTable.store(parsed, channel, size);
        await parsed
            .reply({
            content: `Created \`${channel.name}\` queue.` + (await this.genQueuesList(parsed)),
        })
            .catch(() => null);
    }
    static async queuesAdd(parsed) {
        await parsed.readArgs({
            commandNameLength: 10,
            hasChannel: true,
            numberArgs: { min: 1, max: 99, defaultValue: null },
        });
        const channel = parsed.args.channel;
        if (!channel)
            return;
        const storedChannels = await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(parsed.request.guild);
        if (storedChannels.some((stored) => stored.id === channel.id)) {
            await parsed
                .reply({
                content: `\`${channel.name}\` is already a queue.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            const channelLim = channel.userLimit;
            let size = parsed.args.num;
            if (!size && channelLim)
                size = channelLim;
            if (["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type)) {
                if (channel.permissionsFor(parsed.request.guild.me).has("CONNECT")) {
                    await this.storeQueue(parsed, channel, size);
                    if (size && channel.type === "GUILD_VOICE") {
                        if (channel.permissionsFor(parsed.request.guild.me).has("MANAGE_CHANNELS")) {
                            await channel.setUserLimit(size).catch(() => null);
                        }
                        else {
                            setTimeout(async () => await parsed
                                .reply({
                                content: "I can automatically set voice channel user limits, but I need a new permission:\n" +
                                    "`Server Settings` > `Roles` > `Queue Bot` > `Permissions` tab > enable `Manage Channels`.\n" +
                                    "If that does not work, check the channel-specific permissions.",
                                commandDisplay: "EPHEMERAL",
                            })
                                .catch(() => null), 1000);
                        }
                    }
                }
                else {
                    await parsed
                        .reply({
                        content: `**ERROR**: I need the **CONNECT** permission in the \`${channel.name}\` voice channel to pull in queue members.`,
                        commandDisplay: "EPHEMERAL",
                    })
                        .catch(() => null);
                }
            }
            else {
                await this.storeQueue(parsed, channel, size);
            }
        }
    }
    static async queuesDelete(parsed) {
        await parsed.readArgs({ commandNameLength: 13, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id);
        if (storedQueueChannel) {
            await QueueChannelTable_1.QueueChannelTable.unstore(parsed.request.guild.id, queueChannel.id, parsed);
            const response = `Deleted queue for \`${queueChannel.name}\`.` + (await this.genQueuesList(parsed));
            await parsed
                .reply({
                content: response,
            })
                .catch(() => null);
            VoiceUtils_1.Voice.disconnectFromChannel(queueChannel);
        }
        else {
            const response = `\`${queueChannel.name}\` is not a queue.` + (await this.genQueuesList(parsed));
            await parsed
                .reply({
                content: response,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
    }
    static async queuesList(parsed) {
        await parsed.readArgs({ commandNameLength: 11 });
        const response = await this.genQueuesList(parsed);
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async rolesGet(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 9 })).length)
            return;
        await parsed
            .reply({
            content: "**Queue Roles**: " + (parsed.queueGuild.disable_roles ? "off" : "on"),
        })
            .catch(() => null);
    }
    static async rolesSet(parsed) {
        if ((await parsed.readArgs({ commandNameLength: 9, hasText: true })).length)
            return;
        if (!["on", "off"].includes(parsed.args.text.toLowerCase())) {
            await parsed
                .reply({
                content: "**ERROR**: Missing required argument: `on` or `off`.",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        if ((parsed.queueGuild.disable_roles && parsed.args.text === "off") ||
            (!parsed.queueGuild.disable_roles && parsed.args.text === "on")) {
            await parsed
                .reply({
                content: `Roles were already ${parsed.args.text}.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
        else {
            const guild = parsed.request.guild;
            const disableRoles = parsed.args.text === "off";
            await QueueGuildTable_1.QueueGuildTable.setDisableRoles(guild.id, disableRoles);
            await parsed.reply({ content: `Set roles to \`${parsed.args.text}\`.` }).catch(() => null);
            const storedQueueChannels = await QueueChannelTable_1.QueueChannelTable.getFromGuild(guild.id);
            for await (const storedQueueChannel of storedQueueChannels) {
                const channel = (await parsed.getChannels()).find((ch) => ch.id === storedQueueChannel.queue_channel_id);
                if (!channel)
                    continue;
                if (disableRoles) {
                    const role = await guild.roles
                        .fetch(storedQueueChannel.role_id)
                        .catch(() => null);
                    if (role) {
                        await QueueChannelTable_1.QueueChannelTable.deleteRoleId(channel).catch(() => null);
                        await role.delete().catch(() => null);
                    }
                }
                else {
                    const role = await QueueChannelTable_1.QueueChannelTable.createQueueRole(parsed, channel, storedQueueChannel.color);
                    if (role) {
                        const queueMembers = await QueueMemberTable_1.QueueMemberTable.getFromQueue(channel);
                        for await (const queueMember of queueMembers) {
                            await guild.members
                                .fetch(queueMember.member_id)
                                .then((member) => member.roles.add(role));
                        }
                    }
                    else {
                        break;
                    }
                }
            }
        }
    }
    static async shuffle(parsed) {
        await parsed.readArgs({ commandNameLength: 7, hasChannel: true });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        const queueMembers = await QueueMemberTable_1.QueueMemberTable.getFromQueue(queueChannel);
        const queueMemberTimeStamps = queueMembers.map((member) => member.created_at);
        Base_1.Base.shuffle(queueMemberTimeStamps);
        for (let i = 0, l = queueMembers.length; i < l; i++) {
            await QueueMemberTable_1.QueueMemberTable.setCreatedAt(queueMembers[i].id, queueMemberTimeStamps[i]);
        }
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        await parsed
            .reply({
            content: `\`${queueChannel.name}\` queue shuffled.`,
        })
            .catch(() => null);
    }
    static async sizeGet(parsed) {
        await parsed.readArgs({ commandNameLength: 8 });
        let response = "**Sizes**:\n";
        for await (const storedQueueChannel of await parsed.getStoredQueueChannels()) {
            const queueChannel = (await parsed.request.guild.channels
                .fetch(storedQueueChannel.queue_channel_id)
                .catch(() => null));
            if (!queueChannel)
                continue;
            response += `\`${queueChannel.name}\`: ${storedQueueChannel.max_members || "none"}\n`;
        }
        await parsed
            .reply({
            content: response,
        })
            .catch(() => null);
    }
    static async sizeSet(parsed) {
        await parsed.readArgs({
            commandNameLength: 8,
            hasChannel: true,
            hasNumber: true,
            numberArgs: { min: 1, max: 99, defaultValue: null },
        });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        let max = parsed.args.num;
        MessagingUtils_1.MessagingUtils.updateDisplay(parsed.queueGuild, queueChannel);
        await QueueChannelTable_1.QueueChannelTable.setMaxMembers(queueChannel.id, max);
        await parsed
            .reply({
            content: `Set \`${queueChannel.name}\` size to \`${max ? max : "unlimited"}\` users.`,
        })
            .catch(() => null);
        if (queueChannel.type === "GUILD_VOICE") {
            if (queueChannel.permissionsFor(parsed.request.guild.me).has("MANAGE_CHANNELS")) {
                queueChannel.setUserLimit(max).catch(() => null);
            }
            else {
                await parsed
                    .reply({
                    content: "I can automatically change the user limit of voice channels, but I need a new permission:\n" +
                        "`Server Settings` > `Roles` > `Queue Bot` > `Permissions` tab > enable `Manage Channels`.\n" +
                        "If that does'nt work, check the channel-specific permissions.",
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
            }
        }
    }
    static async start(parsed) {
        await parsed.readArgs({
            commandNameLength: 5,
            hasChannel: true,
            channelType: ["GUILD_VOICE", "GUILD_STAGE_VOICE"],
        });
        const queueChannel = parsed.args.channel;
        if (!queueChannel?.id)
            return;
        if (queueChannel.permissionsFor(parsed.request.guild.me).has("CONNECT")) {
            if (!queueChannel.full) {
                await VoiceUtils_1.Voice.connectToChannel(queueChannel).catch(() => null);
                await parsed
                    .reply({
                    content: "Started.",
                })
                    .catch(() => null);
            }
            else {
                await parsed
                    .reply({
                    content: `**ERROR**: I can't join \`${queueChannel.name}\` because it is full.`,
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
            }
        }
        else {
            await parsed
                .reply({
                content: `**ERROR**: I don't have permission to join ${queueChannel.name}.`,
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
        }
    }
    static async toMe(parsed) {
        await parsed.readArgs({
            commandNameLength: 5,
            hasChannel: true,
            channelType: ["GUILD_VOICE"],
            numberArgs: { min: 1, max: 99, defaultValue: null },
        });
        const targetChannel = parsed.request.member.voice.channel;
        if (!targetChannel) {
            await parsed
                .reply({
                content: "**ERROR**: You must be in a voice channel to use `/to-me`",
                commandDisplay: "EPHEMERAL",
            })
                .catch(() => null);
            return;
        }
        await this.pullMembers(parsed, targetChannel);
    }
}
exports.Commands = Commands;
