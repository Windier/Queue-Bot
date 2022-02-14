"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueChannelTable = void 0;
const Base_1 = require("../Base");
const DisplayChannelTable_1 = require("./DisplayChannelTable");
const QueueMemberTable_1 = require("./QueueMemberTable");
const Commands_1 = require("../../Commands");
const BlackWhiteListTable_1 = require("./BlackWhiteListTable");
const SlashCommands_1 = require("../SlashCommands");
const QueueGuildTable_1 = require("./QueueGuildTable");
const MessagingUtils_1 = require("../MessagingUtils");
class QueueChannelTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("queue_channels").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("queue_channels", (table) => {
                    table.bigInteger("queue_channel_id").primary();
                    table.integer("auto_fill");
                    table.text("color");
                    table.integer("grace_period");
                    table.bigInteger("guild_id");
                    table.text("header");
                    table.boolean("hide_button");
                    table.boolean("is_locked");
                    table.integer("max_members");
                    table.integer("pull_num");
                    table.bigInteger("target_channel_id");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static get(queueChannelId) {
        return Base_1.Base.knex("queue_channels")
            .where("queue_channel_id", queueChannelId)
            .first();
    }
    static getFromGuild(guildId) {
        return Base_1.Base.knex("queue_channels").where("guild_id", guildId);
    }
    static getFromTarget(targetChannelId) {
        return Base_1.Base.knex("queue_channels").where("target_channel_id", targetChannelId);
    }
    static async setHeader(queueChannelId, message) {
        await this.get(queueChannelId).update("header", message);
    }
    static async setHideButton(queueChannelId, hidden) {
        await this.get(queueChannelId).update("hide_button", hidden);
    }
    static async setLock(queueChannelId, is_locked) {
        await this.get(queueChannelId).update("is_locked", is_locked);
    }
    static async setMaxMembers(queueChannelId, max) {
        await this.get(queueChannelId).update("max_members", max);
    }
    static async setTarget(queueChannelId, targetChannelId) {
        await this.get(queueChannelId).update("target_channel_id", targetChannelId);
    }
    static async setColor(queueChannel, value) {
        await this.get(queueChannel.id).update("color", value);
        const storedQueueChannel = await this.get(queueChannel.id);
        if (storedQueueChannel?.role_id) {
            const role = await queueChannel.guild.roles
                .fetch(storedQueueChannel.role_id)
                .catch(() => null);
            await role?.setColor(value).catch(() => null);
        }
    }
    static async setGraceperiod(queueChannelId, value) {
        await this.get(queueChannelId).update("grace_period", value);
    }
    static async setAutopull(queueChannelId, value) {
        await this.get(queueChannelId).update("auto_fill", value);
    }
    static async setPullnum(queueChannelId, value) {
        await this.get(queueChannelId).update("pull_num", value);
    }
    static async setRoleId(queueChannel, role) {
        await this.get(queueChannel.id).update("role_id", role.id);
        const queueMembers = await QueueMemberTable_1.QueueMemberTable.getFromQueue(queueChannel);
        for await (const queueMember of queueMembers) {
            const member = await QueueMemberTable_1.QueueMemberTable.getMemberFromQueueMember(queueChannel, queueMember);
            if (!member)
                continue;
            await member.roles.add(role);
        }
    }
    static async deleteRoleId(queueChannel) {
        await this.get(queueChannel.id).update("role_id", Base_1.Base.knex.raw("DEFAULT"));
    }
    static async fetchFromGuild(guild) {
        const queueChannelIdsToRemove = [];
        const storedQueueChannels = await Base_1.Base.knex("queue_channels").where("guild_id", guild.id);
        const channels = (await guild.channels.fetch().catch(() => null));
        const queueChannels = [];
        for (let i = storedQueueChannels.length - 1; i >= 0; i--) {
            const queueChannelId = storedQueueChannels[i].queue_channel_id;
            const queueChannel = channels.find((s) => s.id === queueChannelId);
            if (queueChannel) {
                queueChannels.push(queueChannel);
            }
            else {
                queueChannelIdsToRemove.push(queueChannelId);
            }
        }
        for await (const queueChannelId of queueChannelIdsToRemove) {
            await this.unstore(guild.id, queueChannelId);
        }
        return queueChannels;
    }
    static async createQueueRole(parsed, channel, color) {
        const role = await channel.guild.roles
            .create({
            color: color,
            mentionable: true,
            name: "In queue: " + channel.name,
        })
            .catch(async (e) => {
            if ([403, 404].includes(e.httpStatus)) {
                await parsed
                    .reply({
                    content: "WARNING: I could not create a server role. If you want queue members to receive a role, follow these steps:" +
                        "\n1. Grant me the Manage Roles permission **or** click the link below." +
                        "\n2. Then use `/display` to create role.",
                    embeds: [
                        {
                            title: "Update Permission",
                            url: Base_1.Base.inviteURL,
                        },
                    ],
                    commandDisplay: "EPHEMERAL",
                })
                    .catch(() => null);
                return null;
            }
        });
        if (role)
            await QueueChannelTable.setRoleId(channel, role);
        return role;
    }
    static async deleteQueueRole(guildId, channel, parsed) {
        await this.get(channel.queue_channel_id).update("role_id", Base_1.Base.knex.raw("DEFAULT"));
        const roleId = channel?.role_id;
        if (roleId) {
            const guild = await Base_1.Base.client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const role = await guild.roles.fetch(roleId).catch(() => null);
                await role?.delete().catch(async (e) => {
                    if ([403, 404].includes(e.httpStatus)) {
                        await parsed
                            .reply({
                            content: `ERROR: Failed to delete server role for queue. Please:\n1. Grant me the Manage Roles permission **or** click this link\n2. Manually delete the \`${role.name}\` role`,
                            embeds: [
                                {
                                    title: "Update Permission",
                                    url: Base_1.Base.inviteURL,
                                },
                            ],
                            commandDisplay: "EPHEMERAL",
                        })
                            .catch(console.error);
                    }
                });
            }
        }
    }
    static async store(parsed, channel, maxMembers) {
        await Base_1.Base.knex("queue_channels")
            .insert({
            auto_fill: 1,
            color: Base_1.Base.config.color,
            grace_period: Base_1.Base.config.gracePeriod,
            guild_id: channel.guild.id,
            max_members: maxMembers,
            pull_num: 1,
            queue_channel_id: channel.id,
        })
            .catch(() => null);
        if (["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type)) {
            for await (const member of channel.members.filter((member) => !member.user.bot).values()) {
                await QueueMemberTable_1.QueueMemberTable.store(channel, member).catch(() => null);
            }
        }
        await Commands_1.Commands.display(parsed, channel);
        setTimeout(() => SlashCommands_1.SlashCommands.modifyCommandsForGuild(parsed.request.guild, parsed).catch(() => null), 500);
        if ((await QueueChannelTable.getFromGuild(parsed.request.guild.id)).length > 25) {
            await parsed.reply({
                content: `WARNING: \`${channel.name}\` will not be available in slash commands due to a Discord limit of 25 choices per command parameter. ` +
                    ` To interact with this new queue, you must use the alternate prefix (\`/altprefix on\`) or delete another queue.`,
            });
        }
    }
    static async unstore(guildId, channelId, parsed) {
        let query = Base_1.Base.knex("queue_channels").where("guild_id", guildId);
        if (channelId)
            query = query.where("queue_channel_id", channelId);
        const queueChannels = await query;
        for await (const queueChannel of queueChannels) {
            await this.deleteQueueRole(guildId, queueChannel, parsed);
            await BlackWhiteListTable_1.BlackWhiteListTable.unstore(2, queueChannel.queue_channel_id);
            await DisplayChannelTable_1.DisplayChannelTable.unstore(queueChannel.queue_channel_id);
            await QueueMemberTable_1.QueueMemberTable.unstore(guildId, queueChannel.queue_channel_id);
        }
        await query.delete();
        const guild = await Base_1.Base.client.guilds.fetch(guildId).catch(() => null);
        if (guild) {
            setTimeout(() => SlashCommands_1.SlashCommands.modifyCommandsForGuild(guild, parsed).catch(() => null), 500);
        }
    }
    static async validate(requireGuildUpdate, guild, channels, members, roles) {
        const storedEntries = await this.getFromGuild(guild.id);
        for await (const entry of storedEntries) {
            let requireChannelUpdate = false;
            const queueChannel = channels.find((c) => c.id === entry.queue_channel_id);
            if (queueChannel) {
                const results = await Promise.all([
                    BlackWhiteListTable_1.BlackWhiteListTable.validate(queueChannel, members, roles),
                    DisplayChannelTable_1.DisplayChannelTable.validate(queueChannel, channels),
                    QueueMemberTable_1.QueueMemberTable.validate(queueChannel, members),
                ]);
                if (results.includes(true)) {
                    requireChannelUpdate = true;
                }
            }
            else {
                await this.unstore(guild.id, entry.queue_channel_id);
                requireChannelUpdate = true;
            }
            if (requireGuildUpdate || requireChannelUpdate) {
                const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(guild.id);
                MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, queueChannel);
            }
        }
    }
}
exports.QueueChannelTable = QueueChannelTable;
