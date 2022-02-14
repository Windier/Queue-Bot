"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisplayChannelTable = void 0;
const Base_1 = require("../Base");
const MessagingUtils_1 = require("../MessagingUtils");
class DisplayChannelTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("display_channels").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("display_channels", (table) => {
                    table.increments("id").primary();
                    table.bigInteger("queue_channel_id");
                    table.bigInteger("display_channel_id");
                    table.bigInteger("message_id");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static get(displayChannelId) {
        return Base_1.Base.knex("display_channels")
            .where("display_channel_id", displayChannelId)
            .first();
    }
    static getFromQueue(queueChannelId) {
        return Base_1.Base.knex("display_channels").where("queue_channel_id", queueChannelId);
    }
    static getFirstFromQueue(queueChannelId) {
        return Base_1.Base.knex("display_channels")
            .where("queue_channel_id", queueChannelId)
            .first();
    }
    static getFromMessage(messageId) {
        return Base_1.Base.knex("display_channels").where("message_id", messageId).first();
    }
    static async store(queueChannel, displayChannel, embeds) {
        const response = await displayChannel
            .send({
            embeds: embeds,
            components: await MessagingUtils_1.MessagingUtils.getButton(queueChannel),
            allowedMentions: { users: [] },
        })
            .catch(() => null);
        if (!response)
            return;
        await Base_1.Base.knex("display_channels").insert({
            display_channel_id: displayChannel.id,
            message_id: response.id,
            queue_channel_id: queueChannel.id,
        });
    }
    static async unstore(queueChannelId, displayChannelId, deleteOldDisplays = true) {
        let query = Base_1.Base.knex("display_channels").where("queue_channel_id", queueChannelId);
        if (displayChannelId)
            query = query.where("display_channel_id", displayChannelId);
        const storedDisplayChannels = await query;
        await query.delete();
        if (!storedDisplayChannels)
            return;
        for await (const storedDisplayChannel of storedDisplayChannels) {
            const displayChannel = (await Base_1.Base.client.channels
                .fetch(storedDisplayChannel.display_channel_id)
                .catch(() => null));
            if (!displayChannel)
                continue;
            const displayMessage = await displayChannel.messages
                .fetch(storedDisplayChannel.message_id, { cache: false })
                .catch(() => null);
            if (!displayMessage)
                continue;
            if (deleteOldDisplays) {
                await displayMessage.delete().catch(() => null);
            }
            else {
                await displayMessage
                    .edit({ embeds: displayMessage.embeds, components: [] })
                    .catch(() => null);
            }
        }
    }
    static async validate(queueChannel, channels) {
        let updateRequired = false;
        const storedEntries = await this.getFromQueue(queueChannel.id);
        for await (const entry of storedEntries) {
            if (!channels.some((c) => c.id === entry.display_channel_id)) {
                await this.unstore(queueChannel.id, entry.display_channel_id);
                updateRequired = true;
            }
        }
        return updateRequired;
    }
}
exports.DisplayChannelTable = DisplayChannelTable;
