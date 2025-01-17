import { GuildChannel, GuildMember, Role, Snowflake } from "discord.js";
import { Base } from "../Base";
import { BlackWhiteListEntry } from "../Interfaces";

export class BlackWhiteListTable {
  /**
   * Create & update DisplayChannel database table if necessary
   */
  public static async initTable(): Promise<void> {
    await Base.knex.schema.hasTable("black_white_list").then(async (exists) => {
      if (!exists) {
        await Base.knex.schema
          .createTable("black_white_list", (table) => {
            table.increments("id").primary();
            table.bigInteger("queue_channel_id");
            table.bigInteger("role_member_id");
            table.integer("type");
            table.boolean("is_role");
          })
          .catch((e) => console.error(e));
      }
    });
  }

  private static async isBWlisted(
    queueChannelId: Snowflake,
    member: GuildMember,
    type: number
  ): Promise<boolean> {
    const roleIds = Array.from(member.roles.valueOf().keys());
    for await (const id of [member.id, ...roleIds]) {
      const memberPerm = await Base.knex<BlackWhiteListEntry>("black_white_list")
        .where("queue_channel_id", queueChannelId)
        .where("role_member_id", id)
        .where("type", type)
        .first();
      if (memberPerm) return true;
    }
    return false;
  }

  public static async isBlacklisted(
    queueChannelId: Snowflake,
    member: GuildMember
  ): Promise<boolean> {
    return await this.isBWlisted(queueChannelId, member, 0);
  }

  public static async isWhitelisted(
    queueChannelId: Snowflake,
    member: GuildMember
  ): Promise<boolean> {
    return await this.isBWlisted(queueChannelId, member, 1);
  }

  public static async hasWhitelist(queueChannelId: Snowflake): Promise<boolean> {
    return (
      (await Base.knex<BlackWhiteListEntry>("black_white_list")
        .where("queue_channel_id", queueChannelId)
        .where("type", 1)
        .first()) != null
    );
  }

  public static get(type: number, queueChannelId: Snowflake, roleMemberId: Snowflake) {
    return Base.knex<BlackWhiteListEntry>("black_white_list")
      .where("queue_channel_id", queueChannelId)
      .where("role_member_id", roleMemberId)
      .where("type", type)
      .first();
  }

  public static getMany(type: number, queueChannelId: Snowflake) {
    return Base.knex<BlackWhiteListEntry>("black_white_list")
      .where("queue_channel_id", queueChannelId)
      .where("type", type);
  }

  public static async store(
    type: number,
    queueChannelId: Snowflake,
    roleMemberId: Snowflake,
    isRole: boolean
  ): Promise<void> {
    await Base.knex<BlackWhiteListEntry>("black_white_list").insert({
      queue_channel_id: queueChannelId,
      role_member_id: roleMemberId,
      type: type,
      is_role: isRole,
    });
  }

  /**
   * @param type - 0 black, 1 white, 2 both
   * @param queueChannelId
   * @param roleMemberId
   */
  public static async unstore(
    type: number,
    queueChannelId: Snowflake,
    roleMemberId?: Snowflake
  ): Promise<void> {
    let query = Base.knex<BlackWhiteListEntry>("black_white_list").where(
      "queue_channel_id",
      queueChannelId
    );
    if (type !== 2) query = query.where("type", type);
    if (roleMemberId) query = query.where("role_member_id", roleMemberId);
    await query.delete();
  }

  public static async validate(
    queueChannel: GuildChannel,
    members: GuildMember[],
    roles: Role[]
  ): Promise<boolean> {
    let updateRequired = false;
    for await (const type of [0, 1]) {
      const storedEntries = await this.getMany(type, queueChannel.id);
      for await (const entry of storedEntries) {
        if (entry.is_role) {
          if (!roles.some((r) => r.id === entry.role_member_id)) {
            await this.unstore(type, entry.queue_channel_id, entry.role_member_id);
            updateRequired = true;
          }
        } else {
          const member = members.find((m) => m.id === entry.role_member_id);
          if (member) {
            // member.guild.members.cache.set(member.id, member); // cache
          } else {
            await this.unstore(type, entry.queue_channel_id, entry.role_member_id);
            updateRequired = true;
          }
        }
      }
    }
    return updateRequired;
  }
}
