import { Inject, Injectable } from "@nestjs/common";

import { SESSION_HMAC_KEYRING } from "./auth.constants.js";
import { VersionedHmacKeyring } from "./keyring.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isValidOpaqueToken,
} from "./token.js";

/** 一次预认证 Session 签发返回的明文材料；明文只在响应中出现一次。 */
export interface PreauthMaterial {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly sessionTokenHash: Buffer;
  readonly csrfTokenHash: Buffer;
  readonly tokenHashKeyVersion: number;
}

export interface TokenHashAndVersion {
  readonly hash: Buffer;
  readonly keyVersion: number;
}

/**
 * 认证/预认证令牌的生成与哈希服务。明文字符串只存在于内存与单次响应，
 * 数据库与日志只保存 HMAC-SHA-256 哈希；校验使用记录中的密钥版本重算，
 * 保证 Session HMAC keyring 轮换后旧 Token 仍可验证。
 */
@Injectable()
export class SessionTokenService {
  constructor(
    @Inject(SESSION_HMAC_KEYRING)
    private readonly keyring: VersionedHmacKeyring,
  ) {}

  issuePreauthMaterial(): PreauthMaterial {
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    return {
      sessionToken,
      csrfToken,
      sessionTokenHash: hashOpaqueToken(
        sessionToken,
        this.keyring.currentKey(),
      ),
      csrfTokenHash: hashOpaqueToken(csrfToken, this.keyring.currentKey()),
      tokenHashKeyVersion: this.keyring.currentVersion,
    };
  }

  hash(token: string): TokenHashAndVersion {
    return {
      hash: hashOpaqueToken(token, this.keyring.currentKey()),
      keyVersion: this.keyring.currentVersion,
    };
  }

  hashWithVersion(token: string, keyVersion: number): Buffer {
    return hashOpaqueToken(token, this.keyring.keyFor(keyVersion));
  }

  /** 对同一令牌按 keyring 中每个版本计算候选哈希，用于轮换后仍可查回旧 Session。 */
  hashCandidates(token: string): readonly TokenHashAndVersion[] {
    if (!isValidOpaqueToken(token)) {
      return [];
    }
    return this.keyring.versions.map((version) => ({
      hash: hashOpaqueToken(token, this.keyring.keyFor(version)),
      keyVersion: version,
    }));
  }
}
