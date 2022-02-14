"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Voice = void 0;
const voice_1 = require("@discordjs/voice");
const discord_js_1 = require("discord.js");
class Voice {
    static trackClient(client) {
        if (Voice.trackedClients.has(client))
            return;
        Voice.trackedClients.add(client);
        client.ws.on(discord_js_1.Constants.WSEvents.VOICE_SERVER_UPDATE, (payload) => {
            Voice.adapters.get(payload.guild_id)?.onVoiceServerUpdate(payload);
        });
        client.ws.on(discord_js_1.Constants.WSEvents.VOICE_STATE_UPDATE, (payload) => {
            if (payload.guild_id && payload.session_id && payload.user_id === client.user?.id) {
                Voice.adapters.get(payload.guild_id)?.onVoiceStateUpdate(payload);
            }
        });
        client.on(discord_js_1.Constants.Events.SHARD_DISCONNECT, (_, shardID) => {
            const guilds = Voice.trackedShards.get(shardID);
            if (guilds) {
                for (const guildId of guilds.values()) {
                    Voice.adapters.get(guildId)?.destroy();
                }
            }
            Voice.trackedShards.delete(shardID);
        });
    }
    static trackGuild(guild) {
        let guilds = Voice.trackedShards.get(guild.shardId);
        if (!guilds) {
            guilds = new Set();
            Voice.trackedShards.set(guild.shardId, guilds);
        }
        guilds.add(guild.id);
    }
    static createDiscordJSAdapter(channel) {
        return (methods) => {
            Voice.adapters.set(channel.guild.id, methods);
            Voice.trackClient(channel.client);
            Voice.trackGuild(channel.guild);
            return {
                sendPayload(data) {
                    if (channel.guild.shard.status === discord_js_1.Constants.Status.READY) {
                        channel.guild.shard.send(data);
                        return true;
                    }
                    return false;
                },
                destroy() {
                    return Voice.adapters.delete(channel.guild.id);
                },
            };
        };
    }
    static disconnectFromChannel(channel) {
        try {
            Voice.connections.get(channel.id)?.destroy();
        }
        catch (e) {
        }
    }
    static async connectToChannel(channel) {
        const connection = (0, voice_1.joinVoiceChannel)({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: Voice.createDiscordJSAdapter(channel),
            selfDeaf: true,
            selfMute: true,
        });
        try {
            await (0, voice_1.entersState)(connection, voice_1.VoiceConnectionStatus.Ready, 30e3);
            Voice.connections.set(channel.id, connection);
            return connection;
        }
        catch (error) {
            connection.destroy();
            throw error;
        }
    }
}
exports.Voice = Voice;
Voice.connections = new Map();
Voice.adapters = new Map();
Voice.trackedShards = new Map();
Voice.trackedClients = new Set();
