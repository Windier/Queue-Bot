import { AdminPermission } from "../Interfaces";
import { Base } from "../Base";
import { Guild, GuildMember, Role, Snowflake } from "discord.js";

export class AdminPermissionTable {
  /**
   * Create & update AdminPermission database table if necessary
   */
  public static async initTable(): Promise<void> {
    await Base.knex.schema.hasTable("admin_permission").then(async (exists) => {
      if (!exists) {
        await Base.knex.schema
          .createTable("admin_permission", (table) => {
            table.increments("id").primary();
            table.bigInteger("guild_id");
            table.bigInteger("role_member_id");
            table.boolean("is_role");
          })
          .catch((e) => console.error(e));
      }
    });
  }

  public static async get(guildId: Snowflake, roleMemberId: Snowflake) {
    return Base.knex<AdminPermission>("admin_permission")
      .where("guild_id", guildId)
      .where("role_member_id", roleMemberId)
      .first();
  }

  public static async getMany(guildId: Snowflake) {
    return Base.knex<AdminPermission>("admin_permission").where("guild_id", guildId);
  }

  public static async store(
    guildId: Snowflake,
    roleMemberId: Snowflake,
    isRole: boolean
  ): Promise<void> {
    await Base.knex<AdminPermission>("admin_permission")
      .insert({
        guild_id: guildId,
        role_member_id: roleMemberId,
        is_role: isRole,
      })
      .catch(() => null);
  }

  public static async unstore(guildId: Snowflake, roleMemberId?: Snowflake): Promise<void> {
    let query = Base.knex<AdminPermission>("admin_permission").where("guild_id", guildId);
    if (roleMemberId) query = query.where("role_member_id", roleMemberId);
    await query.first().delete();
  }

  public static async validate(guild: Guild, members: GuildMember[], roles: Role[]): Promise<void> {
    const storedEntries = await this.getMany(guild.id);
    for await (const entry of storedEntries) {
      if (entry.is_role) {
        if (!roles.some((r) => r.id === entry.role_member_id)) {
          await this.unstore(guild.id, entry.role_member_id);
        }
      } else {
        const member = members.find((m) => m.id === entry.role_member_id);
        if (member) {
          // member.guild.members.cache.set(member.id, member); // cache
        } else {
          await this.unstore(guild.id, entry.role_member_id);
        }
      }
    }
  }
}
