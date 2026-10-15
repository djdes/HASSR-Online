// Generated from the frozen public-features semantic source map.
// Runtime projection is immutable; coverage tests bind each slot to its source.
import { FEATURES_INFO, type FeatureInfo } from "@/content/features";
import type { Messages } from "@/i18n/messages";

export type FeatureSlug = keyof Messages["publicFeatures"]["features"];
type CopyKey<S extends FeatureSlug> = keyof Messages["publicFeatures"]["features"][S];
type BlockCopy<S extends FeatureSlug> = { text?: CopyKey<S>; title?: CopyKey<S>; items?: Record<number, CopyKey<S>> };
type FeatureCopy<S extends FeatureSlug> = { title: CopyKey<S>; tagline: CopyKey<S>; body: Record<number, BlockCopy<S>> };

export const FEATURE_COPY_MANIFEST = {
  "qr": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "stickersHeading"
      },
      "2": {
        "items": {
          "0": "stickersFridges",
          "1": "stickersChangingRoom",
          "2": "stickersLamps",
          "3": "stickersFryers",
          "4": "stickersStorage",
          "5": "stickersGeneral"
        }
      },
      "3": {
        "text": "recordHeading"
      },
      "4": {
        "items": {
          "0": "record1",
          "1": "record2",
          "2": "record3",
          "3": "record4"
        }
      },
      "5": {
        "text": "issuesHeading"
      },
      "6": {
        "items": {
          "0": "issue1",
          "1": "issue2",
          "2": "issue3"
        }
      },
      "7": {
        "title": "startTitle",
        "text": "startText"
      }
    }
  },
  "sync-iiko-1c": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "syncHeading"
      },
      "2": {
        "items": {
          "0": "sync1",
          "1": "sync2",
          "2": "sync3",
          "3": "sync4",
          "4": "sync5"
        }
      },
      "3": {
        "text": "humanHeading"
      },
      "4": {
        "text": "humanText"
      },
      "5": {
        "title": "connectTitle",
        "text": "connectText"
      }
    }
  },
  "autofill": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "automaticHeading"
      },
      "2": {
        "items": {
          "0": "automatic1",
          "1": "automatic2",
          "2": "automatic3",
          "3": "automatic4"
        }
      },
      "3": {
        "text": "forbiddenHeading"
      },
      "4": {
        "items": {
          "0": "forbidden1",
          "1": "forbidden2",
          "2": "forbidden3",
          "3": "forbidden4"
        }
      },
      "5": {
        "title": "cautionTitle",
        "text": "cautionText"
      }
    }
  },
  "cloud": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "devicesHeading"
      },
      "2": {
        "items": {
          "0": "device1",
          "1": "device2",
          "2": "device3",
          "3": "device4"
        }
      },
      "3": {
        "text": "securityHeading"
      },
      "4": {
        "text": "securityText"
      },
      "5": {
        "title": "retentionTitle",
        "text": "retentionText"
      }
    }
  },
  "role-access": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "levelsHeading"
      },
      "2": {
        "items": {
          "0": "level1",
          "1": "level2",
          "2": "level3"
        }
      },
      "3": {
        "text": "aclHeading"
      },
      "4": {
        "text": "aclText"
      },
      "5": {
        "title": "auditTitle",
        "text": "auditText"
      }
    }
  },
  "reminders": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "channelsHeading"
      },
      "2": {
        "items": {
          "0": "channel1",
          "1": "channel2",
          "2": "channel3",
          "3": "channel4"
        }
      },
      "3": {
        "text": "scheduleHeading"
      },
      "4": {
        "text": "scheduleText"
      },
      "5": {
        "title": "smsTitle",
        "text": "smsText"
      }
    }
  },
  "alerts": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "triggersHeading"
      },
      "2": {
        "items": {
          "0": "trigger1",
          "1": "trigger2",
          "2": "trigger3",
          "3": "trigger4",
          "4": "trigger5"
        }
      },
      "3": {
        "text": "recipientsHeading"
      },
      "4": {
        "text": "recipientsText"
      },
      "5": {
        "title": "capaTitle",
        "text": "capaText"
      }
    }
  },
  "paperless": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "stopHeading"
      },
      "2": {
        "items": {
          "0": "stop1",
          "1": "stop2",
          "2": "stop3",
          "3": "stop4"
        }
      },
      "3": {
        "text": "signatureHeading"
      },
      "4": {
        "text": "signatureText"
      },
      "5": {
        "title": "savingsTitle",
        "text": "savingsText"
      }
    }
  },
  "time-saving": {
    "title": "title",
    "tagline": "tagline",
    "body": {
      "0": {
        "text": "intro"
      },
      "1": {
        "text": "sourcesHeading"
      },
      "2": {
        "items": {
          "0": "source1",
          "1": "source2",
          "2": "source3",
          "3": "source4"
        }
      },
      "3": {
        "title": "networksTitle",
        "text": "networksText"
      },
      "4": {
        "text": "closing"
      }
    }
  }
} as const satisfies { [S in FeatureSlug]: FeatureCopy<S> };

export function isFeatureSlug(value: string): value is FeatureSlug {
  return Object.hasOwn(FEATURE_COPY_MANIFEST, value) && Object.hasOwn(FEATURES_INFO, value);
}

export function presentFeature<S extends FeatureSlug>(slug: S, messages: Pick<Messages, "publicFeatures">): FeatureInfo {
  const source = FEATURES_INFO[slug];
  const mapping = FEATURE_COPY_MANIFEST[slug] as unknown as FeatureCopy<S>;
  const copy = messages.publicFeatures.features[slug];
  const text = (key: CopyKey<S> | undefined): string => {
    if (key === undefined) throw new Error(`Unmapped feature text: ${slug}`);
    return String(copy[key]);
  };
  return {
    ...source,
    title: text(mapping.title),
    tagline: text(mapping.tagline),
    body: source.body.map((block, index) => {
      const binding = mapping.body[index];
      if (!binding) throw new Error(`Unmapped feature block: ${slug}/${index}`);
      if (block.type === "ul" || block.type === "ol") return { ...block, items: block.items.map((_, item) => text(binding.items?.[item])) };
      if (block.type === "faq") throw new Error(`Unmapped feature FAQ: ${slug}/${index}`);
      const translated = { ...block, text: text(binding.text) };
      if (block.type === "quote" && block.author) throw new Error(`Unmapped feature author: ${slug}/${index}`);
      return block.type === "callout" && block.title ? { ...translated, type: "callout" as const, title: text(binding.title) } : translated;
    }),
  };
}
