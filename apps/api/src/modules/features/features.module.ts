import {
  FeatureLinkQueryPort,
  FeatureLinkCommandPort,
} from "./external-link-target.port.js";
import { Module } from "@nestjs/common";
import { FeatureReadPort } from "./feature-read.port.js";
import { PostgresFeatureReadPort } from "./postgres-feature-read-port.js";
import { FeatureQueryPort } from "./feature-query.port.js";
import { PostgresFeatureQueryPort } from "./postgres-feature-query-port.js";

@Module({
  providers: [
    FeatureLinkQueryPort,
    FeatureLinkCommandPort,
    { provide: FeatureReadPort, useClass: PostgresFeatureReadPort },
    { provide: FeatureQueryPort, useClass: PostgresFeatureQueryPort },
  ],
  exports: [
    FeatureLinkQueryPort,
    FeatureLinkCommandPort,
    FeatureQueryPort,
    FeatureReadPort,
  ],
})
export class FeaturesModule {}
