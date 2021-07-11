import { QueueMember } from "../Interfaces";
import { Base } from "../Base";
import { Guild, GuildMember, Snowflake, TextChannel, VoiceChannel } from "discord.js";
import { BlackWhiteListTable } from "./BlackWhiteListTable";
import { PriorityTable } from "./PriorityTable";

export class QueueMemberTable {
   /**
    * Create & update QueueGuild database table if necessary
    */
   public static async initTable(): Promise<void> {
      await Base.getKnex()
         .schema.hasTable("queue_members")
         .then(async (exists) => {
            if (!exists) {
               await Base.getKnex()
                  .schema.createTable("queue_members", (table) => {
                     table.increments("id").primary();
                     table.bigInteger("channel_id");
                     table.bigInteger("member_id");
                     table.text("personal_message");
                     table.timestamp("created_at").defaultTo(Base.getKnex().fn.now());
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
      const entries = await Base.getKnex()<QueueMember>("queue_members").where("channel_id", queueChannel.id);
      for await (const entry of entries) {
         const member = await guild.members.fetch(entry.member_id).catch(() => null as GuildMember);
         if (!member) {
            this.unstore(queueChannel.id, [entry.member_id]);
         }
      }
   }

   public static get(channelId: Snowflake, queueMemberId: Snowflake) {
      return Base.getKnex()<QueueMember>("queue_members").where("channel_id", channelId).where("member_id", queueMemberId).first();
   }

   public static getFromId(id: Snowflake) {
      return Base.getKnex()<QueueMember>("queue_members").where("id", id).first();
   }

   public static getFromMember(queueMemberId: Snowflake) {
      return Base.getKnex()<QueueMember>("queue_members").where("member_id", queueMemberId);
   }

   public static async setPriority(channelId: Snowflake, queueMemberId: Snowflake, isPriority: boolean): Promise<void> {
      await Base.getKnex()<QueueMember>("queue_members")
         .where("channel_id", channelId)
         .where("member_id", queueMemberId)
         .first()
         .update("is_priority", isPriority);
   }

   /**
    * UNORDERED. Fetch members for channel, filter out users who have left the guild.
    */
   public static async getFromQueue(queueChannel: TextChannel | VoiceChannel): Promise<QueueMember[]> {
      let query = Base.getKnex()<QueueMember>("queue_members").where("channel_id", queueChannel.id);

      const storedMembers = await query;
      for await (const storedMember of storedMembers) {
         storedMember.member = await queueChannel.guild.members.fetch(storedMember.member_id).catch(() => null as GuildMember);
      }
      return storedMembers.filter((storedMember) => storedMember.member);
   }

   /**
    * Fetch members for channel, filter out users who have left the guild.
    */
   public static async getNext(queueChannel: TextChannel | VoiceChannel, amount?: number): Promise<QueueMember[]> {
      let query = Base.getKnex()<QueueMember>("queue_members")
         .where("channel_id", queueChannel.id)
         .orderBy([{ column: "is_priority", order: "desc" }, "created_at"]);
      if (amount) query = query.limit(amount);

      const storedMembers = await query;
      for await (const storedMember of storedMembers) {
         storedMember.member = await queueChannel.guild.members.fetch(storedMember.member_id).catch(() => null as GuildMember);
      }
      return storedMembers.filter((storedMember) => storedMember.member);
   }

   private static unstoredMembersCache = new Map<Snowflake, string>();

   public static async store(
      queueChannel: VoiceChannel | TextChannel,
      member: GuildMember,
      customMessage?: string,
      force?: boolean
   ): Promise<boolean> {
      if ((await BlackWhiteListTable.isBlacklisted(queueChannel.id, member)) && !force) {
         return false;
      } else {
         const isPriority = await PriorityTable.isPriority(queueChannel.guild.id, member);
         await Base.getKnex()<QueueMember>("queue_members").insert({
            created_at: this.unstoredMembersCache.get(member.id),
            is_priority: isPriority,
            personal_message: customMessage,
            channel_id: queueChannel.id,
            member_id: member.id,
         });
         this.unstoredMembersCache.delete(member.id);
         return true;
      }
   }

   public static async unstore(channelId: Snowflake, memberIdsToRemove?: Snowflake[], gracePeriod?: number): Promise<void> {
      // Retreive list of stored embeds for display channel
      let query = Base.getKnex()<QueueMember>("queue_members").where("channel_id", channelId);
      if (memberIdsToRemove) {
         query = query.whereIn("member_id", memberIdsToRemove);
         if (gracePeriod) {
            // Cache members
            for (const queueMember of await query) {
               this.unstoredMembersCache.set(queueMember.member_id, queueMember.created_at);
               // Schedule cleanup of cached member
               setTimeout(() => this.unstoredMembersCache.delete(queueMember.member_id), gracePeriod * 1000);
            }
         }
      }
      await query.delete();
   }
}
