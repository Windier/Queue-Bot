"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlashCommands = void 0;
const delay_1 = __importDefault(require("delay"));
const discord_slash_commands_client_1 = require("discord-slash-commands-client");
const Base_1 = require("./Base");
const QueueChannelTable_1 = require("./tables/QueueChannelTable");
class SlashCommands {
    static async editProgress(suMsg) {
        await suMsg.resp
            ?.edit(suMsg.respText +
            "\n[" +
            "▓".repeat(++suMsg.progNum) +
            "░".repeat(suMsg.totalNum - suMsg.progNum) +
            "]")
            .catch(() => null);
        await (0, delay_1.default)(5000);
    }
    static modifyQueueArg(cmd, storedChannels) {
        if (cmd.options)
            cmd.options = this.modifyQueue(cmd.name, cmd.options, storedChannels);
        return cmd;
    }
    static modifyQueue(name, options, storedChannels) {
        for (let i = options.length - 1; i >= 0; i--) {
            const option = options[i];
            if (option.type === 1 || option.type === 2) {
                if (option.options?.length) {
                    option.options = this.modifyQueue(name, option.options, storedChannels);
                }
            }
            else if (option.type === 7) {
                if (this.TEXT_COMMANDS.includes(name)) {
                    storedChannels = storedChannels.filter((ch) => ch.type === "GUILD_TEXT");
                }
                else if (this.VOICE_COMMANDS.includes(name)) {
                    storedChannels = storedChannels.filter((ch) => ["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(ch.type));
                }
                if (storedChannels.length > 1) {
                    const choices = storedChannels.map((ch) => {
                        return { name: ch.name, value: ch.id };
                    });
                    options[i] = {
                        name: option.name,
                        description: option.description,
                        type: 3,
                        required: option.required,
                        choices: choices,
                    };
                }
                else {
                    options.splice(i, 1);
                }
            }
        }
        return options;
    }
    static async modify(guildId, parsed, storedChannels) {
        const now = Date.now();
        this.commandRegistrationCache.set(guildId, now);
        let commands = JSON.parse(JSON.stringify(Base_1.Base.commands));
        commands = commands.filter((c) => !this.GLOBAL_COMMANDS.includes(c.name));
        const msgTest = "Registering queue commands. This will take about 2 minutes...";
        const slashUpdateMessage = {
            resp: await parsed?.reply({ content: msgTest }).catch(() => null),
            respText: msgTest,
            progNum: 0,
            totalNum: commands.length,
        };
        if (!storedChannels.find((ch) => ch.type === "GUILD_TEXT")) {
            const excludedTextCommands = this.TEXT_COMMANDS;
            commands = commands.filter((c) => !excludedTextCommands.includes(c.name));
            let liveCommands = (await this.slashClient
                .getCommands({ guildID: guildId })
                .catch(() => []));
            liveCommands = liveCommands.filter((cmd) => cmd.application_id === Base_1.Base.client.user.id);
            for await (const excludedTextCommand of excludedTextCommands) {
                if (this.commandRegistrationCache.get(guildId) !== now) {
                    slashUpdateMessage.resp?.delete().catch(() => null);
                    return;
                }
                const liveCommand = liveCommands.find((cmd) => cmd.name === excludedTextCommand);
                if (liveCommand)
                    await this.slashClient.deleteCommand(liveCommand.id, guildId).catch(console.error);
                await this.editProgress(slashUpdateMessage);
            }
        }
        for await (let command of commands) {
            if (this.commandRegistrationCache.get(guildId) !== now) {
                slashUpdateMessage.resp?.delete().catch(() => null);
                return;
            }
            command = await this.modifyQueueArg(command, storedChannels);
            await this.slashClient.createCommand(command, guildId).catch(() => null);
            await this.editProgress(slashUpdateMessage);
        }
        await slashUpdateMessage.resp
            ?.edit({ content: "Done registering queue commands." })
            .catch(() => null);
    }
    static async modifyForNoQueues(guildId, parsed) {
        const now = Date.now();
        this.commandRegistrationCache.set(guildId, now);
        const commands = (await this.slashClient
            .getCommands({ guildID: guildId })
            .catch(() => []));
        const filteredCommands = commands.filter((cmd) => !this.GLOBAL_COMMANDS.includes(cmd.name) && cmd.application_id === Base_1.Base.client.user.id);
        const msgTest = "Unregistering queue commands. This will take about 2 minutes...";
        const slashUpdateMessage = {
            resp: await parsed?.reply({ content: msgTest }).catch(() => null),
            respText: msgTest,
            progNum: 0,
            totalNum: commands.length,
        };
        for await (let command of filteredCommands) {
            if (this.commandRegistrationCache.get(guildId) !== now) {
                slashUpdateMessage.resp?.delete().catch(() => null);
                return;
            }
            await this.slashClient.deleteCommand(command.id, guildId).catch(() => null);
            await this.editProgress(slashUpdateMessage);
        }
        await slashUpdateMessage.resp
            ?.edit({ content: "Done unregistering queue commands." })
            .catch(() => null);
    }
    static async addCommandForGuild(guild, cmd) {
        cmd = JSON.parse(JSON.stringify(cmd));
        const storedChannels = (await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(guild))?.slice(0, 25);
        if (storedChannels.length) {
            cmd = await this.modifyQueueArg(cmd, storedChannels);
            await SlashCommands.slashClient.createCommand(cmd, guild.id);
        }
    }
    static async modifyCommandsForGuild(guild, parsed) {
        try {
            const storedChannels = (await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(guild))?.slice(0, 25);
            if (storedChannels.length === 0) {
                await this.modifyForNoQueues(guild.id, parsed);
            }
            else {
                await this.modify(guild.id, parsed, storedChannels);
            }
        }
        catch (e) {
            console.error(e);
        }
    }
    static async updateCommandsForOfflineGuildChanges(guilds) {
        for await (const guild of guilds) {
            const channels = Array.from((await guild.channels.fetch())
                .filter((ch) => ["GUILD_VOICE", "GUILD_STAGE_VOICE", "GUILD_TEXT"].includes(ch.type))
                .values());
            const storedChannels = await QueueChannelTable_1.QueueChannelTable.getFromGuild(guild.id);
            let updateRequired = false;
            for await (const storedChannel of storedChannels) {
                if (!channels.some((ch) => ch.id === storedChannel.queue_channel_id)) {
                    await QueueChannelTable_1.QueueChannelTable.unstore(guild.id, storedChannel.queue_channel_id);
                    updateRequired = true;
                }
            }
            if (updateRequired) {
                this.modifyCommandsForGuild(guild).then();
                await (0, delay_1.default)(6000);
            }
        }
        console.log("Done updating commands for offline guild changes.");
    }
    static async registerGlobalCommands() {
        let liveCommands = (await this.slashClient.getCommands({}));
        liveCommands = liveCommands.filter((cmd) => cmd.application_id === Base_1.Base.client.user.id);
        for await (const command of liveCommands) {
            if (!this.GLOBAL_COMMANDS.includes(command.name)) {
                await this.slashClient.deleteCommand(command.id);
                await (0, delay_1.default)(5000);
            }
        }
        for await (const name of this.GLOBAL_COMMANDS) {
            const command = Base_1.Base.commands.find((cmd) => cmd.name === name);
            await this.slashClient.createCommand(command).catch(console.error);
            await (0, delay_1.default)(5000);
        }
    }
    static async register(guild) {
        this.registerGlobalCommands().then();
        this.updateCommandsForOfflineGuildChanges(guild).then();
    }
}
exports.SlashCommands = SlashCommands;
SlashCommands.GLOBAL_COMMANDS = ["altprefix", "help", "queues", "permission"];
SlashCommands.TEXT_COMMANDS = ["button"];
SlashCommands.VOICE_COMMANDS = ["autopull", "start", "to-me"];
SlashCommands.slashClient = new discord_slash_commands_client_1.Client(Base_1.Base.config.token, Base_1.Base.config.clientId);
SlashCommands.commandRegistrationCache = new Map();

