import { QueueChannel, QueueMember } from "../Interfaces";
import { Base } from "../Base";
import { Guild, GuildMember, Snowflake, TextChannel, VoiceChannel } from "discord.js";
import { BlackWhiteListTable } from "./BlackWhiteListTable";
import { PriorityTable } from "./PriorityTable";
import { QueueChannelTable } from "./QueueChannelTable";

export class QueueMemberTable {
   /**
    * Create & update QueueGuild database table if necessary
    */
   public static async initTable(): Promise<void> {
      await Base.knex.schema.hasTable("queue_members").then(async (exists) => {
         if (!exists) {
            await Base.knex.schema
               .createTable("queue_members", (table) => {
                  table.increments("id").primary();
                  table.bigInteger("channel_id");
                  table.bigInteger("member_id");
                  table.text("personal_message");
                  table.timestamp("created_at").defaultTo(Base.knex.fn.now());
                  table.boolean("is_priority");
               })
               .catch((e) => console.error(e));
         }
      });
   }

   /**
    * Cleanup deleted Display Channels
    **/
   public static async validateEntries(guild: Guild, queueChannel: VoiceChannel | TextChannel) {
      const entries = await Base.knex<QueueMember>("queue_members").where("channel_id", queueChannel.id);
      for await (const entry of entries) {
         try {
            const member = await guild.members.fetch(entry.member_id);
            if (!member) {
               await this.unstore(guild.id, queueChannel.id, [entry.member_id]);
            }
         } catch (e) {
            // SKIP
         }
      }
   }

   public static get(channelId: Snowflake, memberId: Snowflake) {
      return Base.knex<QueueMember>("queue_members").where("channel_id", channelId).where("member_id", memberId).first();
   }

   public static getFromChannels(queueChannelIds: Snowflake[], memberId: Snowflake) {
      return Base.knex<QueueMember>("queue_members").whereIn("channel_id", queueChannelIds).where("member_id", memberId);
   }

   public static getFromId(id: Snowflake) {
      return Base.knex<QueueMember>("queue_members").where("id", id).first();
   }

   public static async setCreatedAt(memberId: Snowflake, time: string): Promise<void> {
      await this.getFromId(memberId).update("created_at", time);
   }

   public static async setPriority(channelId: Snowflake, memberId: Snowflake, isPriority: boolean): Promise<void> {
      await Base.knex<QueueMember>("queue_members")
         .where("channel_id", channelId)
         .where("member_id", memberId)
         .first()
         .update("is_priority", isPriority);
   }

   /**
    * UNORDERED. Fetch members for channel, filter out users who have left the guild.
    */
   public static async getFromQueue(queueChannel: TextChannel | VoiceChannel) {
      return Base.knex<QueueMember>("queue_members").where("channel_id", queueChannel.id);
   }

   /**
    * WARNING THIS MIGHT BE SLOW
    */
   public static async getMemberFromQueueMember(queueChannel: TextChannel | VoiceChannel, queueMember: QueueMember): Promise<GuildMember> {
      try {
         return await queueChannel.guild.members.fetch(queueMember.member_id);
      } catch (e) {
         if (e.httpStatus === 404) {
            await QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id, [queueMember.member_id]);
         }
         return undefined;
      }
   }

   /**
    *
    */
   public static async getNext(queueChannel: TextChannel | VoiceChannel, amount?: number): Promise<QueueMember[]> {
      let query = Base.knex<QueueMember>("queue_members")
         .where("channel_id", queueChannel.id)
         .orderBy([{ column: "is_priority", order: "desc" }, "created_at"]);
      if (amount) query = query.limit(amount);

      return await query;
   }

   private static unstoredMembersCache = new Map<Snowflake, string>();

   public static async store(
      queueChannel: VoiceChannel | TextChannel,
      member: GuildMember,
      customMessage?: string,
      force?: boolean
   ): Promise<void> {
      if (!force) {
         if (await BlackWhiteListTable.isBlacklisted(queueChannel.id, member)) {
            throw {
               author: "Queue Bot",
               message: `<@${member.id}> is blacklisted from \`${queueChannel.name}\`.\n`,
            };
         }
         const storedChannel = await QueueChannelTable.get(queueChannel.id);
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
         storedMember.personal_message = customMessage;
         await QueueMemberTable.get(queueChannel.id, member.id).update(storedMember);
      } else {
         await Base.knex<QueueMember>("queue_members").insert({
            created_at: this.unstoredMembersCache.get(member.id),
            is_priority: await PriorityTable.isPriority(queueChannel.guild.id, member),
            personal_message: customMessage,
            channel_id: queueChannel.id,
            member_id: member.id,
         });
      }
      this.unstoredMembersCache.delete(member.id);
      // Assign Queue Role
      const StoredQueueChannel = await QueueChannelTable.get(queueChannel.id).catch(() => null as QueueChannel);
      if (StoredQueueChannel?.role_id) {
         await member.roles.add(StoredQueueChannel.role_id).catch(() => null);
      }
   }

   public static async unstore(guildId: Snowflake, channelId: Snowflake, memberIds?: Snowflake[], gracePeriod?: number): Promise<void> {
      // Retreive list of stored embeds for display channel
      let query = Base.knex<QueueMember>("queue_members").where("channel_id", channelId);
      if (memberIds) {
         query = query.whereIn("member_id", memberIds);
         if (gracePeriod) {
            // Cache members
            for (const queueMember of await query) {
               this.unstoredMembersCache.set(queueMember.member_id, queueMember.created_at);
               // Schedule cleanup of cached member
               setTimeout(() => this.unstoredMembersCache.delete(queueMember.member_id), gracePeriod * 1000);
            }
         }
      }
      const deletedMembers = await query;
      await query.delete();
      // Unassign Queue Role
      const storedQueueChannel = await QueueChannelTable.get(channelId).catch(() => null as QueueChannel);
      if (!storedQueueChannel?.role_id) return;

      const guild = await Base.client.guilds.fetch(guildId).catch(() => null as Guild);
      if (!guild) return;

      for await (const deletedMember of deletedMembers) {
         const member = await guild.members.fetch(deletedMember.member_id).catch(() => null as GuildMember);
         if (!member) continue;
         await member.roles.remove(storedQueueChannel.role_id).catch(() => null);
      }
   }
}
