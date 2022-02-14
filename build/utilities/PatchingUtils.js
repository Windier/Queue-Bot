"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchingUtils = void 0;
const Base_1 = require("./Base");
const fs_1 = require("fs");
const delay_1 = __importDefault(require("delay"));
const knex_schema_inspector_1 = __importDefault(require("knex-schema-inspector"));
const QueueChannelTable_1 = require("./tables/QueueChannelTable");
const DisplayChannelTable_1 = require("./tables/DisplayChannelTable");
const MessagingUtils_1 = require("./MessagingUtils");
const AdminPermissionTable_1 = require("./tables/AdminPermissionTable");
const BlackWhiteListTable_1 = require("./tables/BlackWhiteListTable");
const PriorityTable_1 = require("./tables/PriorityTable");
const QueueGuildTable_1 = require("./tables/QueueGuildTable");
const QueueMemberTable_1 = require("./tables/QueueMemberTable");
const lodash_1 = __importDefault(require("lodash"));
const SlashCommands_1 = require("./SlashCommands");
class PatchingUtils {
    static async run(guilds) {
        await this.initTables();
        await this.tableBlackWhiteList();
        await this.tableQueueMembers();
        await this.tableQueueChannels();
        await this.tableAdminPermission();
        await this.tableDisplayChannels();
        await this.tableQueueGuilds();
        this.checkNotes(guilds).then();
        this.checkCommandsFile().then();
    }
    static async checkCommandsFile() {
        if (Base_1.Base.haveCommandsChanged()) {
            let addedCommands = Base_1.Base.commands.filter((c) => lodash_1.default.findIndex(Base_1.Base.lastCommands, c) === -1);
            let removedCommands = Base_1.Base.lastCommands.filter((c) => lodash_1.default.findIndex(Base_1.Base.commands, c) === -1);
            if (addedCommands.length > 0) {
                console.log("commands-config.json has changed. Added: " + addedCommands.map((c) => c.name).join(", "));
            }
            if (removedCommands.length > 0) {
                console.log("commands-config.json has changed. Removed: " +
                    removedCommands.map((c) => c.name).join(", "));
            }
            let progressCnt = 0;
            const guilds = Array.from(Base_1.Base.client.guilds.cache.values());
            console.log("Updating commands for command-config.json change... [1/" + guilds.length + "]");
            for await (const guild of guilds) {
                if (addedCommands) {
                    for await (let cmd of addedCommands) {
                        if (SlashCommands_1.SlashCommands.GLOBAL_COMMANDS.includes(cmd.name)) {
                            await SlashCommands_1.SlashCommands.slashClient.createCommand(cmd).catch(() => null);
                        }
                        else {
                            await SlashCommands_1.SlashCommands.addCommandForGuild(guild, cmd).catch(() => null);
                        }
                        await (0, delay_1.default)(100);
                    }
                }
                if (removedCommands) {
                    for await (const cmd of removedCommands) {
                        if (SlashCommands_1.SlashCommands.GLOBAL_COMMANDS.includes(cmd.name)) {
                            const globalCommand = (await SlashCommands_1.SlashCommands.slashClient
                                .getCommands()
                                .catch(() => [])).find((c) => c.name === cmd.name);
                            await SlashCommands_1.SlashCommands.slashClient.deleteCommand(globalCommand.id).catch(() => null);
                        }
                        else {
                            const guildCommands = (await SlashCommands_1.SlashCommands.slashClient
                                .getCommands({
                                guildID: guild.id,
                            })
                                .catch(() => []));
                            for await (const guildCommand of guildCommands) {
                                if (cmd.name === guildCommand.name) {
                                    await SlashCommands_1.SlashCommands.slashClient
                                        .deleteCommand(guildCommand.id, guild.id)
                                        .catch(() => null);
                                    break;
                                }
                            }
                        }
                        await (0, delay_1.default)(100);
                    }
                }
                if (++progressCnt % 50 === 0) {
                    console.log("Updating commands for command-config.json change... [" +
                        progressCnt +
                        "/" +
                        guilds.length +
                        "]");
                }
            }
            console.log("Done updating commands for command-config.json change.");
            Base_1.Base.archiveCommands();
        }
    }
    static async checkNotes(guilds) {
        const displayChannels = [];
        if ((0, fs_1.existsSync)("../patch_notes/patch_notes.json")) {
            const notes = JSON.parse((0, fs_1.readFileSync)("../patch_notes/patch_notes.json", "utf8"));
            const notesToSend = notes.filter((p) => !p.sent);
            if (!notesToSend?.length)
                return;
            for await (const guild of guilds) {
                await guild.channels.fetch();
                try {
                    const queueChannelId = (await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(guild))[0]?.id;
                    if (!queueChannelId)
                        continue;
                    const displayChannelId = (await DisplayChannelTable_1.DisplayChannelTable.getFromQueue(queueChannelId).first())
                        ?.display_channel_id;
                    if (!displayChannelId)
                        continue;
                    const displayChannel = (await guild.channels
                        .fetch(displayChannelId)
                        .catch(() => null));
                    if (!displayChannel)
                        continue;
                    displayChannels.push(displayChannel);
                }
                catch (e) {
                }
                await (0, delay_1.default)(100);
            }
            let sentNote = false;
            const failedChannelIds = [];
            let i = 0;
            for await (const note of notesToSend) {
                for await (const displayChannel of displayChannels) {
                    if (!note.embeds)
                        continue;
                    try {
                        await displayChannel.send({ embeds: note.embeds });
                    }
                    catch (e) {
                        failedChannelIds.push(displayChannel.id);
                    }
                    await (0, delay_1.default)(100);
                    if (++i % 20 === 0) {
                        console.log(`Patching progress: ${i}/${displayChannels.length * notesToSend.length}`);
                    }
                }
                const announcementChannel = (await Base_1.Base.client.channels
                    .fetch(Base_1.Base.config.announcementChannelId)
                    .catch(() => null));
                if (announcementChannel) {
                    await announcementChannel.send({ embeds: note.embeds }).catch(() => null);
                }
                note.sent = sentNote = true;
            }
            if (sentNote) {
                (0, fs_1.writeFileSync)("../patch_notes/patch_notes.json", JSON.stringify(notes, null, 3));
            }
            if (failedChannelIds.length) {
                console.log("FAILED TO SEND TO THE FOLLOWING CHANNEL IDS:");
                console.log(failedChannelIds);
            }
        }
    }
    static async initTables() {
        if (!(await Base_1.Base.knex.schema.hasTable("admin_permission"))) {
            await AdminPermissionTable_1.AdminPermissionTable.initTable();
        }
        if (!(await Base_1.Base.knex.schema.hasTable("black_white_list"))) {
            await BlackWhiteListTable_1.BlackWhiteListTable.initTable();
        }
        if (!(await Base_1.Base.knex.schema.hasTable("display_channels"))) {
            await DisplayChannelTable_1.DisplayChannelTable.initTable();
        }
        if (!(await Base_1.Base.knex.schema.hasTable("priority"))) {
            await PriorityTable_1.PriorityTable.initTable();
        }
        if (!(await Base_1.Base.knex.schema.hasTable("queue_channels"))) {
            await QueueChannelTable_1.QueueChannelTable.initTable();
        }
        if (!(await Base_1.Base.knex.schema.hasTable("queue_guilds"))) {
            await QueueGuildTable_1.QueueGuildTable.initTable();
        }
        if (!(await Base_1.Base.knex.schema.hasTable("queue_members"))) {
            await QueueMemberTable_1.QueueMemberTable.initTable();
        }
    }
    static async tableAdminPermission() {
        if (await Base_1.Base.knex.schema.hasTable("queue_manager_roles")) {
            await Base_1.Base.knex.schema.renameTable("queue_manager_roles", "admin_permission");
            await Base_1.Base.knex.schema.raw("ALTER SEQUENCE queue_manager_roles_id_seq RENAME TO admin_permission_id_seq");
            await (0, delay_1.default)(1000);
            await Base_1.Base.knex.schema.alterTable("admin_permission", (table) => {
                table.renameColumn("role_name", "role_member_id");
                table.boolean("is_role");
            });
            const entries = await Base_1.Base.knex("admin_permission");
            console.log("Admin Table updates");
            for await (const entry of entries) {
                try {
                    const guild = await Base_1.Base.client.guilds.fetch(entry.guild_id).catch(() => null);
                    if (!guild)
                        throw "GUILD NOT FOUND";
                    let newId;
                    let isRole = false;
                    if (entry.role_member_id.startsWith("<@")) {
                        const id = entry.role_member_id.replace(/\D/g, "");
                        const member = await guild.members.fetch(id).catch(() => null);
                        if (member)
                            newId = id;
                    }
                    else {
                        await guild.roles.fetch();
                        newId = guild.roles.cache.find((role) => role.name === entry.role_member_id)?.id;
                        isRole = true;
                    }
                    if (!newId)
                        throw "ID NOT FOUND";
                    await Base_1.Base.knex("admin_permission")
                        .where("id", entry.id)
                        .update("role_member_id", newId)
                        .update("is_role", isRole);
                }
                catch (e) {
                    await Base_1.Base.knex("admin_permission")
                        .where("id", entry.id)
                        .first()
                        .delete();
                }
                await (0, delay_1.default)(40);
            }
            await Base_1.Base.knex.schema.alterTable("admin_permission", (table) => {
                table.bigInteger("guild_id").alter();
                table.bigInteger("role_member_id").alter();
            });
        }
    }
    static async tableBlackWhiteList() {
        if (await Base_1.Base.knex.schema.hasTable("member_perms")) {
            await Base_1.Base.knex.schema.renameTable("member_perms", "black_white_list");
            await Base_1.Base.knex.schema.raw("ALTER SEQUENCE member_perms_id_seq RENAME TO black_white_list_id_seq");
            await (0, delay_1.default)(100);
            await Base_1.Base.knex.schema.alterTable("black_white_list", (table) => {
                table.renameColumn("perm", "type");
                table.renameColumn("member_id", "role_member_id");
                table.boolean("is_role");
            });
            await Base_1.Base.knex.schema.alterTable("black_white_list", (table) => {
                table.bigInteger("queue_channel_id").alter();
                table.bigInteger("role_member_id").alter();
            });
            await Base_1.Base.knex("black_white_list").update("is_role", false);
        }
    }
    static async tableDisplayChannels() {
        if (await Base_1.Base.knex.schema.hasColumn("display_channels", "embed_id")) {
            await Base_1.Base.knex.schema.alterTable("display_channels", (table) => {
                table.specificType("embed_ids", "text ARRAY");
            });
            await Base_1.Base.knex.schema.alterTable("display_channels", (table) => {
                table.bigInteger("queue_channel_id").alter();
                table.bigInteger("display_channel_id").alter();
            });
            for await (const displayChannel of await Base_1.Base.knex("display_channels")) {
                await Base_1.Base.knex("display_channels")
                    .where("queue_channel_id", displayChannel.queue_channel_id)
                    .where("display_channel_id", displayChannel.display_channel_id)
                    .update("embed_ids", [displayChannel["embed_id"]]);
            }
            await Base_1.Base.knex.schema.table("display_channels", (table) => table.dropColumn("embed_id"));
        }
        if (await Base_1.Base.knex.schema.hasColumn("display_channels", "embed_ids")) {
            await Base_1.Base.knex.schema.alterTable("display_channels", (table) => table.bigInteger("message_id"));
            console.log("Display Channel updates");
            for await (const entry of await Base_1.Base.knex("display_channels")) {
                const displayChannel = (await Base_1.Base.client.channels
                    .fetch(entry.display_channel_id)
                    .catch(() => null));
                const queueChannel = (await Base_1.Base.client.channels
                    .fetch(entry.queue_channel_id)
                    .catch(() => null));
                if (!displayChannel || !queueChannel)
                    continue;
                const embedIds = entry["embed_ids"];
                const messages = [];
                const embeds = [];
                for await (const embedId of embedIds) {
                    const message = await displayChannel.messages.fetch(embedId).catch(() => null);
                    await (0, delay_1.default)(40);
                    if (!message)
                        continue;
                    messages.push(message);
                    embeds.push(message.embeds[0]);
                }
                const response = await messages[0]
                    ?.edit({
                    embeds: embeds,
                    components: await MessagingUtils_1.MessagingUtils.getButton(queueChannel),
                    allowedMentions: { users: [] },
                })
                    .catch(() => null);
                if (response) {
                    await Base_1.Base.knex("display_channels")
                        .where("id", entry.id)
                        .update("message_id", response.id);
                }
                else {
                    await Base_1.Base.knex("display_channels").where("id", entry.id).delete();
                }
                await (0, delay_1.default)(40);
            }
            await Base_1.Base.knex.schema.alterTable("display_channels", (table) => table.dropColumn("embed_ids"));
            this.setNickNames().then();
        }
    }
    static async setNickNames() {
        for await (const entry of await Base_1.Base.knex("queue_guilds")) {
            const guild = await Base_1.Base.client.guilds.fetch(entry.guild_id).catch(() => null);
            if (!guild)
                continue;
            await guild.me.setNickname("Queue Bot").catch(() => null);
            await (0, delay_1.default)(1100);
        }
    }
    static async tableQueueChannels() {
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "max_members"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.text("max_members"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "target_channel_id"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.text("target_channel_id"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "auto_fill"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.integer("auto_fill"));
            await Base_1.Base.knex("queue_channels").update("auto_fill", 1);
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "pull_num"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.integer("pull_num"));
            await Base_1.Base.knex("queue_channels").update("pull_num", 1);
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "header"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.text("header"));
        }
        const inspector = (0, knex_schema_inspector_1.default)(Base_1.Base.knex);
        if ((await inspector.columnInfo("queue_channels", "queue_channel_id")).data_type === "GUILD_TEXT") {
            await Base_1.Base.knex.schema.alterTable("queue_channels", (table) => {
                table.bigInteger("guild_id").alter();
                table.integer("max_members").alter();
                table.bigInteger("target_channel_id").alter();
            });
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "role_id"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.bigInteger("role_id"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "hide_button"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.boolean("hide_button"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "is_locked"))) {
            await Base_1.Base.knex.schema.table("queue_channels", (table) => table.boolean("is_locked"));
        }
    }
    static async tableQueueGuilds() {
        if (await Base_1.Base.knex.schema.hasColumn("queue_guilds", "msg_on_update")) {
            await Base_1.Base.knex.schema.table("queue_guilds", (table) => table.integer("msg_mode"));
            for await (const queueGuild of await Base_1.Base.knex("queue_guilds")) {
                await Base_1.Base.knex("queue_guilds")
                    .where("guild_id", queueGuild.guild_id)
                    .update("msg_mode", queueGuild["msg_on_update"] ? 2 : 1);
            }
            await Base_1.Base.knex.schema.table("queue_guilds", (table) => table.dropColumn("msg_on_update"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_guilds", "cleanup_commands"))) {
            await Base_1.Base.knex.schema.table("queue_guilds", (table) => table.text("cleanup_commands"));
            await Base_1.Base.knex("queue_guilds").update("cleanup_commands", "off");
        }
        if (await Base_1.Base.knex.schema.hasColumn("queue_guilds", "color")) {
            if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "color"))) {
                await Base_1.Base.knex.schema.table("queue_channels", (table) => table.text("color"));
            }
            if (!(await Base_1.Base.knex.schema.hasColumn("queue_channels", "grace_period"))) {
                await Base_1.Base.knex.schema.table("queue_channels", (table) => table.integer("grace_period"));
            }
            const entries = await Base_1.Base.knex("queue_guilds");
            console.log("Migrate QueueGuilds to QueueChannels");
            for await (const entry of entries) {
                await Base_1.Base.knex("queue_channels")
                    .where("guild_id", entry.guild_id)
                    .update("color", entry.color)
                    .update("grace_period", entry.grace_period);
                await (0, delay_1.default)(40);
            }
            await Base_1.Base.knex.schema.alterTable("queue_guilds", (table) => {
                table.dropColumn("grace_period");
                table.dropColumn("color");
                table.dropColumn("cleanup_commands");
            });
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_guilds", "enable_alt_prefix"))) {
            await Base_1.Base.knex.schema.alterTable("queue_guilds", (t) => t.boolean("enable_alt_prefix"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_guilds", "disable_mentions"))) {
            await Base_1.Base.knex.schema.table("queue_guilds", (table) => table.boolean("disable_mentions"));
        }
        if (!(await Base_1.Base.knex.schema.hasColumn("queue_guilds", "disable_roles"))) {
            await Base_1.Base.knex.schema.table("queue_guilds", (table) => table.boolean("disable_roles"));
        }
    }
    static async tableQueueMembers() {
        if (await Base_1.Base.knex.schema.hasColumn("queue_members", "queue_channel_id")) {
            await Base_1.Base.knex.schema.alterTable("queue_members", (table) => {
                table.renameColumn("queue_channel_id", "channel_id");
                table.renameColumn("queue_member_id", "member_id");
                table.boolean("is_priority");
            });
            await Base_1.Base.knex.schema.alterTable("queue_members", (table) => {
                table.bigInteger("channel_id").alter();
                table.bigInteger("member_id").alter();
            });
        }
    }
}
exports.PatchingUtils = PatchingUtils;
