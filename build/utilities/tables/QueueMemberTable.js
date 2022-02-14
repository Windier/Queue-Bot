"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueMemberTable = void 0;
const Base_1 = require("../Base");
const BlackWhiteListTable_1 = require("./BlackWhiteListTable");
const PriorityTable_1 = require("./PriorityTable");
const QueueChannelTable_1 = require("./QueueChannelTable");
const QueueGuildTable_1 = require("./QueueGuildTable");
class QueueMemberTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("queue_members").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("queue_members", (table) => {
                    table.increments("id").primary();
                    table.bigInteger("channel_id");
                    table.bigInteger("member_id");
                    table.text("personal_message");
                    table.timestamp("created_at").defaultTo(Base_1.Base.knex.fn.now());
                    table.boolean("is_priority");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static get(channelId, memberId) {
        return Base_1.Base.knex("queue_members")
            .where("channel_id", channelId)
            .where("member_id", memberId)
            .first();
    }
    static getFromChannels(queueChannelIds, memberId) {
        return Base_1.Base.knex("queue_members")
            .whereIn("channel_id", queueChannelIds)
            .where("member_id", memberId);
    }
    static getFromId(id) {
        return Base_1.Base.knex("queue_members").where("id", id).first();
    }
    static async setCreatedAt(memberId, time) {
        await this.getFromId(memberId).update("created_at", time);
    }
    static async setPriority(channelId, memberId, isPriority) {
        await Base_1.Base.knex("queue_members")
            .where("channel_id", channelId)
            .where("member_id", memberId)
            .first()
            .update("is_priority", isPriority);
    }
    static async getFromQueue(queueChannel) {
        return Base_1.Base.knex("queue_members").where("channel_id", queueChannel.id);
    }
    static async getFromMember(memberId) {
        return Base_1.Base.knex("queue_members").where("member_id", memberId);
    }
    static async getMemberFromQueueMember(queueChannel, queueMember) {
        try {
            return await queueChannel.guild.members.fetch(queueMember.member_id);
        }
        catch (e) {
            if ([403, 404].includes(e.httpStatus)) {
                await QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id, [
                    queueMember.member_id,
                ]);
            }
            return undefined;
        }
    }
    static async getNext(queueChannel, amount) {
        let query = Base_1.Base.knex("queue_members")
            .where("channel_id", queueChannel.id)
            .orderBy([{ column: "is_priority", order: "desc" }, "created_at"]);
        if (amount)
            query = query.limit(amount);
        return query;
    }
    static async store(queueChannel, member, customMessage, force) {
        if (!force) {
            const storedChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id);
            if (storedChannel.is_locked) {
                throw {
                    author: "Queue Bot",
                    message: `Failed to join to \`${queueChannel.name}\`. Queue is locked!\n`,
                };
            }
            if (await BlackWhiteListTable_1.BlackWhiteListTable.hasWhitelist(queueChannel.id)) {
                if (!(await BlackWhiteListTable_1.BlackWhiteListTable.isWhitelisted(queueChannel.id, member))) {
                    throw {
                        author: "Queue Bot",
                        message: `<@${member.id}> is not on the whitelist for \`${queueChannel.name}\`.\n`,
                    };
                }
            }
            else if (await BlackWhiteListTable_1.BlackWhiteListTable.isBlacklisted(queueChannel.id, member)) {
                throw {
                    author: "Queue Bot",
                    message: `<@${member.id}> is blacklisted from \`${queueChannel.name}\`.\n`,
                };
            }
            if (storedChannel.max_members) {
                const storedQueueMembers = await this.getFromQueue(queueChannel);
                if (storedChannel.max_members <= storedQueueMembers?.length) {
                    throw {
                        author: "Queue Bot",
                        message: `Failed to add <@${member.id}> to \`${queueChannel.name}\`. Queue is full!\n`,
                    };
                }
            }
        }
        const storedMember = await QueueMemberTable.get(queueChannel.id, member.id);
        if (storedMember) {
            storedMember.personal_message = customMessage || null;
            await QueueMemberTable.get(queueChannel.id, member.id).update(storedMember);
        }
        else {
            await Base_1.Base.knex("queue_members").insert({
                created_at: this.unstoredMembersCache.get(member.id),
                is_priority: await PriorityTable_1.PriorityTable.isPriority(queueChannel.guild.id, member),
                personal_message: customMessage,
                channel_id: queueChannel.id,
                member_id: member.id,
            });
        }
        this.unstoredMembersCache.delete(member.id);
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id);
        if (storedQueueChannel?.role_id) {
            member.roles
                .add(storedQueueChannel.role_id)
                .catch(() => null)
                .then();
        }
    }
    static async unstoreRoles(guildId, deletedMembers, storedQueueChannel) {
        const guild = await Base_1.Base.client.guilds.fetch(guildId).catch(() => null);
        if (!guild)
            return;
        for await (const deletedMember of deletedMembers) {
            const member = await guild.members
                .fetch(deletedMember.member_id)
                .catch(() => null);
            if (!member)
                continue;
            await member.roles.remove(storedQueueChannel.role_id).catch(() => null);
        }
    }
    static async unstore(guildId, channelId, memberIds, gracePeriod) {
        let query = Base_1.Base.knex("queue_members").where("channel_id", channelId);
        if (memberIds) {
            query = query.whereIn("member_id", memberIds);
            if (gracePeriod) {
                for (const queueMember of await query) {
                    this.unstoredMembersCache.set(queueMember.member_id, queueMember.created_at);
                    setTimeout(() => this.unstoredMembersCache.delete(queueMember.member_id), gracePeriod * 1000);
                }
            }
        }
        const deletedMembers = await query;
        await query.delete();
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(channelId).catch(() => null);
        if (!storedQueueChannel?.role_id)
            return;
        const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(guildId);
        if (!queueGuild.disable_roles) {
            this.unstoreRoles(guildId, deletedMembers, storedQueueChannel).then();
        }
    }
    static async validate(queueChannel, members) {
        let updateRequired = false;
        const storedEntries = await this.getFromQueue(queueChannel);
        for await (const entry of storedEntries) {
            const member = members.find((m) => m.id === entry.member_id);
            if (member) {
            }
            else {
                await this.unstore(queueChannel.guild.id, queueChannel.id, [entry.member_id]);
                updateRequired = true;
            }
        }
        return updateRequired;
    }
}
exports.QueueMemberTable = QueueMemberTable;
QueueMemberTable.unstoredMembersCache = new Map();
