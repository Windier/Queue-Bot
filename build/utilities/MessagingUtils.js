"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagingUtils = void 0;
const discord_js_1 = require("discord.js");
const Base_1 = require("./Base");
const DisplayChannelTable_1 = require("./tables/DisplayChannelTable");
const QueueChannelTable_1 = require("./tables/QueueChannelTable");
const QueueGuildTable_1 = require("./tables/QueueGuildTable");
const QueueMemberTable_1 = require("./tables/QueueMemberTable");
const Validator_1 = require("./Validator");
class MessagingUtils {
    static startScheduler() {
        setInterval(() => {
            if (this.pendingQueueUpdates) {
                for (const request of this.pendingQueueUpdates.values()) {
                    this.internalUpdateDisplay(request);
                }
                this.pendingQueueUpdates.clear();
            }
        }, 1000);
    }
    static updateDisplay(queueGuild, queueChannel) {
        if (queueChannel) {
            this.pendingQueueUpdates.set(queueChannel.id, {
                queueGuild: queueGuild,
                queueChannel: queueChannel,
            });
        }
    }
    static async internalUpdateDisplay(request) {
        const queueGuild = request.queueGuild;
        const queueChannel = request.queueChannel;
        const storedDisplayChannels = await DisplayChannelTable_1.DisplayChannelTable.getFromQueue(queueChannel.id);
        if (!storedDisplayChannels || storedDisplayChannels.length === 0)
            return;
        const embeds = await this.generateEmbed(queueChannel);
        for await (const storedDisplayChannel of storedDisplayChannels) {
            try {
                const displayChannel = (await Base_1.Base.client.channels
                    .fetch(storedDisplayChannel.display_channel_id)
                    .catch(() => null));
                if (displayChannel) {
                    if (displayChannel.permissionsFor(displayChannel.guild.me)?.has("SEND_MESSAGES") &&
                        displayChannel.permissionsFor(displayChannel.guild.me)?.has("EMBED_LINKS")) {
                        const message = await displayChannel.messages
                            .fetch(storedDisplayChannel.message_id)
                            .catch(() => null);
                        if (!message)
                            continue;
                        if (queueGuild.msg_mode === 1) {
                            await message
                                .edit({
                                embeds: embeds,
                                components: await MessagingUtils.getButton(queueChannel),
                                allowedMentions: { users: [] },
                            })
                                .catch(() => null);
                        }
                        else {
                            await DisplayChannelTable_1.DisplayChannelTable.unstore(queueChannel.id, displayChannel.id, queueGuild.msg_mode !== 3);
                            await DisplayChannelTable_1.DisplayChannelTable.store(queueChannel, displayChannel, embeds);
                        }
                    }
                }
                else {
                    await DisplayChannelTable_1.DisplayChannelTable.unstore(queueChannel.id, storedDisplayChannel.display_channel_id);
                }
            }
            catch (e) {
                console.error(e);
            }
            Validator_1.Validator.validateGuild(queueChannel.guild).catch(() => null);
        }
    }
    static getGracePeriodString(gracePeriod) {
        if (!this.gracePeriodCache.has(gracePeriod)) {
            let result;
            if (gracePeriod) {
                const graceMinutes = Math.floor(gracePeriod / 60);
                const graceSeconds = gracePeriod % 60;
                result =
                    (graceMinutes > 0 ? graceMinutes + " minute" : "") +
                        (graceMinutes > 1 ? "s" : "") +
                        (graceMinutes > 0 && graceSeconds > 0 ? " and " : "") +
                        (graceSeconds > 0 ? graceSeconds + " second" : "") +
                        (graceSeconds > 1 ? "s" : "");
            }
            else {
                result = "";
            }
            this.gracePeriodCache.set(gracePeriod, result);
        }
        return this.gracePeriodCache.get(gracePeriod);
    }
    static async generateEmbed(queueChannel) {
        const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(queueChannel.guild.id);
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id);
        if (!storedQueueChannel)
            return [];
        let queueMembers = await QueueMemberTable_1.QueueMemberTable.getNext(queueChannel);
        if (storedQueueChannel.max_members)
            queueMembers = queueMembers.slice(0, +storedQueueChannel.max_members);
        let title = (storedQueueChannel.is_locked ? "🔒 " : "") + queueChannel.name;
        if (storedQueueChannel.target_channel_id) {
            const targetChannel = (await queueChannel.guild.channels
                .fetch(storedQueueChannel.target_channel_id)
                .catch(() => null));
            if (targetChannel) {
                title += `  ->  ${targetChannel.name}`;
            }
            else {
                await QueueChannelTable_1.QueueChannelTable.setTarget(queueChannel.id, Base_1.Base.knex.raw("DEFAULT"));
            }
        }
        let description;
        if (storedQueueChannel.is_locked) {
            description = "Queue is locked.";
        }
        else {
            if (["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(queueChannel.type)) {
                description = `Join <#${queueChannel.id}> to join this queue.`;
            }
            else {
                description = `To interact, click the button or use \`/join\` & \`/leave\`.`;
            }
            const timeString = this.getGracePeriodString(storedQueueChannel.grace_period);
            if (timeString)
                description += `\nIf you leave, you have ** ${timeString}** to rejoin to reclaim your spot.`;
        }
        if (queueMembers.some((member) => member.is_priority))
            description += `\nPriority users are marked with a ⋆.`;
        if (storedQueueChannel.header)
            description += `\n\n${storedQueueChannel.header}`;
        let position = 0;
        const entries = [];
        for (let i = 0, l = queueMembers.length; i < l; i++) {
            const queueMember = queueMembers[i];
            let member;
            if (queueGuild.disable_mentions) {
                member = await queueChannel.guild.members
                    .fetch(queueMember.member_id)
                    .catch(async (e) => {
                    if ([403, 404].includes(e.httpStatus)) {
                        await QueueMemberTable_1.QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id, [
                            queueMember.member_id,
                        ]);
                    }
                    return null;
                });
                if (!member)
                    continue;
            }
            entries.push(`\`${++position < 10 ? position + " " : position}\` ` +
                `${queueMember.is_priority ? "⋆" : ""}` +
                (queueGuild.disable_mentions && member?.displayName
                    ? `\`${member.displayName}#${member?.user?.discriminator}\``
                    : `<@${queueMember.member_id}>`) +
                (queueMember.personal_message ? " -- " + queueMember.personal_message : "") +
                "\n");
        }
        const firstFieldName = storedQueueChannel.max_members
            ? `Capacity:  ${position} / ${storedQueueChannel.max_members}`
            : `Length:  ${position}`;
        const embeds = [];
        let embedLength = title.length + description.length + firstFieldName.length;
        let fields = [];
        let field = { name: "\u200b", value: "", inline: true };
        for (let i = 0, l = entries.length; i < l; i++) {
            const entry = entries[i];
            if (embedLength + entry.length >= 6000) {
                break;
            }
            if (field.value.length + entry.length >= 1024) {
                fields.push(field);
                field = { name: "\u200b", value: "", inline: true };
                embedLength += 1;
            }
            field.value += entry;
            embedLength += entry.length;
        }
        if (!field.value)
            field.value = "\u200b";
        fields.push(field);
        const embed = new discord_js_1.MessageEmbed();
        embed.setTitle(title);
        embed.setColor(storedQueueChannel.color);
        embed.setDescription(description);
        embed.setFields(fields);
        embed.fields[0].name = firstFieldName;
        embeds.push(embed);
        return embeds;
    }
    static async getButton(channel) {
        const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(channel.id);
        if (!["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type) &&
            !storedQueueChannel?.hide_button) {
            return this.rows;
        }
        else {
            return [];
        }
    }
}
exports.MessagingUtils = MessagingUtils;
MessagingUtils.gracePeriodCache = new Map();
MessagingUtils.pendingQueueUpdates = new Map();
MessagingUtils.rows = [
    new discord_js_1.MessageActionRow({
        components: [
            new discord_js_1.MessageButton().setCustomId("joinLeave").setLabel("Join / Leave").setStyle("SECONDARY"),
        ],
    }),
];
