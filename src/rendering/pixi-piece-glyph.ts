import { Container, Graphics } from 'pixi.js';
import type { Piece } from '../types';

export interface PieceGlyph {
  container: Container;
  update(piece: Piece, phase: number | null): void;
}

const TAU = Math.PI * 2;
type Animate = (phase: number | null) => void;

/** Retained mechanical parts: idle motion changes transforms, never the game piece. */
export function createPieceGlyph(piece: Piece, highContrast: boolean): PieceGlyph {
  const container = new Container({ label: `glyph-${piece.type}` });
  const color = piece.owner === 0 ? 0x36b9ff : 0xffb547;
  const width = highContrast ? 2.25 : 1.9;
  const motions: Animate[] = [];
  const missiles: Graphics[] = [];
  const graphic = (label: string, parent: Container = container): Graphics => {
    const node = new Graphics({ label });
    node.setFillStyle({ color }).setStrokeStyle({ color, width });
    parent.addChild(node);
    return node;
  };

  switch (piece.type) {
    case 'soldier': {
      const left = graphic('boot-left').rect(-8, -6, 4, 2.7).fill();
      const right = graphic('boot-right').rect(-8, 3.3, 4, 2.7).fill();
      graphic('soldier-chevron').poly([10, 0, -3, -7, 0, 0, -3, 7]).fill();
      motions.push((phase) => {
        const stride = phase === null ? 0 : Math.sin(phase * 2) * 2;
        left.x = stride;
        right.x = -stride;
      });
      break;
    }
    case 'capturer': {
      graphic('claw-body')
        .arc(-1, 0, 7.5, Math.PI * 0.25, Math.PI * 1.75)
        .stroke()
        .circle(-1, 0, 2.2)
        .fill();
      for (const side of [-1, 1]) {
        const finger = graphic(`claw-finger-${side}`)
          .moveTo(0, 0)
          .lineTo(5.7, side * 2.2)
          .lineTo(3.9, -side * 3.8)
          .stroke();
        finger.position.set(4.3, side * 5.3);
        motions.push((phase) => {
          finger.rotation = phase === null ? 0 : -side * (Math.sin(phase * 1.5) + 1) * 0.2;
        });
      }
      break;
    }
    case 'medium': {
      for (const offset of [0, 0.5]) {
        const smoke = graphic(`tank-exhaust-${offset}`);
        motions.push((phase) => {
          smoke.visible = phase !== null;
          if (phase === null) return;
          const progress = ((((phase / TAU) * 3 + offset) % 1) + 1) % 1;
          smoke.alpha = 1 - progress;
          smoke.position.set(-9 - progress * 4.2, -1 + Math.sin(progress * Math.PI) * 1.5);
          // Only these two tiny smoke arcs change geometry during ambient animation.
          smoke
            .clear()
            .arc(0, 0, 0.8 + progress * 1.6, 0, Math.PI * 1.6)
            .stroke({ color: 0x9fb0b1, width: 1.6 });
        });
      }
      graphic('tank-hull')
        .rect(-7.5, -7, 10.5, 3)
        .stroke()
        .rect(-7.5, 4, 10.5, 3)
        .stroke()
        .poly([-6, -4, 4, -4, 7, 0, 4, 4, -6, 4])
        .stroke()
        .circle(0, 0, 3.2)
        .fill()
        .moveTo(0, 0)
        .lineTo(10, 0)
        .stroke()
        .moveTo(7.5, -1.5)
        .lineTo(7.5, 1.5)
        .stroke();
      break;
    }
    case 'long': {
      graphic('missile-rack')
        .rect(-8, -8, 5, 16)
        .stroke()
        .moveTo(-5.5, -6)
        .lineTo(4.5, -6)
        .moveTo(-5.5, 6)
        .lineTo(4.5, 6)
        .moveTo(-2, -8)
        .lineTo(-2, 8)
        .stroke();
      for (const y of [-4, 4]) {
        const missile = graphic(`missile-${missiles.length}`)
          .poly([-6.5, -1.8, 5.5, -1.8, 10, 0, 5.5, 1.8, -6.5, 1.8])
          .stroke()
          .moveTo(-5, -1.8)
          .lineTo(-8, -4)
          .moveTo(-5, 1.8)
          .lineTo(-8, 4)
          .stroke();
        missile.y = y;
        missiles.push(missile);
        motions.push((phase) => {
          missile.x = phase === null ? 0 : Math.sin(phase * 1.5 + y * 0.25) * 1.5;
        });
      }
      const scanner = graphic('missile-scanner')
        .moveTo(-7.5, 0)
        .lineTo(-3.5, 0)
        .stroke({ color, width: 2 });
      graphic('missile-sensor').circle(-2, 0, 2.4).fill();
      motions.push((phase) => {
        scanner.visible = phase !== null;
        scanner.y = phase === null ? 0 : Math.sin(phase * 1.5) * 5;
      });
      break;
    }
    case 'fast': {
      for (const side of [-1, 1]) {
        const shaft = graphic(`ram-shaft-${side}`).moveTo(0, 0).lineTo(5, 0).stroke();
        shaft.position.set(-10, side * 3);
        const piston = graphic(`ram-piston-${side}`).rect(0, -1.7, 2.8, 3.4).fill();
        piston.position.set(-8, side * 3);
        motions.push((phase) => {
          const compression = phase === null ? 0 : Math.sin(phase * 3 + side) * 1.8;
          shaft.scale.x = (5 + compression) / 5;
          piston.x = -8 + compression;
        });
      }
      const body = graphic('ram-body')
        .poly([10, 0, 1, -6.5, -6, -5, -3, 0, -6, 5, 1, 6.5])
        .stroke()
        .moveTo(2, -3.5)
        .lineTo(7.5, 0)
        .lineTo(2, 3.5)
        .stroke();
      graphic('ram-tracks').moveTo(-8, -8).lineTo(3, -8).moveTo(-8, 8).lineTo(3, 8).stroke();
      motions.push((phase) => {
        body.x = phase === null ? 0 : Math.sin(phase * 3) * 0.8;
      });
      break;
    }
    case 'drone': {
      const frame = graphic('drone-frame');
      for (const [x, y] of [
        [-7, -7],
        [7, -7],
        [7, 7],
        [-7, 7],
      ]) {
        frame
          .moveTo(x * 0.38, y * 0.38)
          .lineTo(x * 0.78, y * 0.78)
          .stroke()
          .circle(x, y, 3)
          .stroke();
        const rotor = graphic(`drone-rotor-${x}-${y}`)
          .moveTo(-1.8, 0)
          .lineTo(1.8, 0)
          .stroke({ color, width: width * 0.55 });
        rotor.position.set(x, y);
        motions.push((phase) => {
          rotor.rotation = phase === null ? 0 : phase * 3;
        });
      }
      graphic('drone-computer')
        .poly([0, -4.5, 4.5, 0, 0, 4.5, -4.5, 0])
        .fill()
        .circle(0, 0, 1.4)
        .fill(0x0b1b22);
      break;
    }
    case 'airplane': {
      const exhaust = new Container({ label: 'jet-exhaust', x: -9.5 });
      container.addChild(exhaust);
      graphic('jet-flame', exhaust)
        .moveTo(0, -2.4)
        .quadraticCurveTo(-3.5, -4, -8, 0)
        .quadraticCurveTo(-3.5, 4, 0, 2.4)
        .closePath()
        .fill(0xff8b3d)
        .poly([0, -1, -5.2, 0, 0, 1])
        .fill(0xfff1bd);
      graphic('airplane-body')
        .poly([
          11, 0, 1.5, -3.2, -2, -10, -5, -9, -3.4, -2.5, -10, -1.6, -10, 1.6, -3.4, 2.5, -5, 9, -2,
          10, 1.5, 3.2,
        ])
        .stroke()
        .moveTo(-5.5, 0)
        .lineTo(6.5, 0)
        .stroke();
      motions.push((phase) => {
        exhaust.visible = phase !== null;
        if (phase === null) return;
        const thrust = 8 + Math.sin(phase * 7) * 1.5 + Math.sin(phase * 11) * 0.7;
        exhaust.scale.x = thrust / 8;
        exhaust.skew.y = -Math.atan((Math.sin(phase * 9) * 0.7) / thrust);
      });
      break;
    }
    case 'antiAir': {
      const dish = new Container({ label: 'radar-dish', y: -1 });
      container.addChild(dish);
      const sweep = graphic('radar-sweep', dish)
        .moveTo(0, 0)
        .arc(0, 0, 12, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22)
        .closePath()
        .fill({ color, alpha: 0.28 })
        .moveTo(0, -2)
        .lineTo(0, -12)
        .stroke();
      graphic('radar-arcs', dish)
        .arc(0, 0, 9, Math.PI * 1.12, Math.PI * 1.88)
        .stroke()
        .beginPath()
        .arc(0, 0, 5.5, Math.PI * 1.12, Math.PI * 1.88)
        .stroke()
        .circle(0, 0, 1.8)
        .fill();
      graphic('anti-air-rack')
        .rect(-7.5, 5, 5, 3.5)
        .stroke()
        .rect(2.5, 5, 5, 3.5)
        .stroke()
        .moveTo(-5, 5)
        .lineTo(-3.5, 2.5)
        .moveTo(5, 5)
        .lineTo(3.5, 2.5)
        .stroke();
      motions.push((phase) => {
        sweep.visible = phase !== null;
        dish.rotation = phase === null ? 0 : Math.sin(phase * 1.2) * 0.5;
      });
      break;
    }
    case 'fortress': {
      for (const side of [-1, 1]) {
        const tower = graphic(`fortress-tower-light-${side}`)
          .rect(side < 0 ? -10 : 7, -7, 3, 15)
          .fill();
        motions.push((phase) => {
          tower.visible = phase !== null;
          tower.alpha =
            phase === null ? 0 : 0.12 + ((Math.sin(phase * 1.4 + side * 1.5) + 1) / 2) * 0.36;
        });
      }
      graphic('fortress-walls')
        .poly([
          -11, 9, -11, -8, -7, -8, -7, -4, -3, -4, -3, -8, 3, -8, 3, -4, 7, -4, 7, -8, 11, -8, 11,
          9,
        ])
        .stroke()
        .moveTo(-3.5, 9)
        .lineTo(-3.5, 4)
        .arc(0, 4, 3.5, Math.PI, 0)
        .lineTo(3.5, 9)
        .stroke();
      const gate = new Container({ label: 'fortress-portcullis', alpha: 0.85 });
      container.addChild(gate);
      const bars = [-1.5, 1.5].map((x) => {
        const bar = graphic(`fortress-gate-bar-${x}`, gate)
          .moveTo(0, 0)
          .lineTo(0, 1)
          .stroke({ color, width: 1 });
        bar.position.set(x, 4);
        return bar;
      });
      const gateCrossbar = graphic('fortress-gate-crossbar', gate).rect(-2.5, 0, 5, 1.5).fill();
      motions.push((phase) => {
        gate.visible = phase !== null;
        if (phase === null) return;
        const lift = (Math.sin(phase * 1.3) + 1) * 1.7;
        for (const bar of bars) bar.scale.y = 5 - lift;
        gateCrossbar.y = 7.5 - lift;
      });
      const left = graphic('fortress-window-left').rect(-8, -1, 2.5, 3.5).fill();
      const right = graphic('fortress-window-right').rect(5.5, -1, 2.5, 3.5).fill();
      motions.push((phase) => {
        left.alpha = phase === null ? 1 : 0.6 + Math.sin(phase * 1.4) * 0.4;
        right.alpha = phase === null ? 1 : 0.6 - Math.sin(phase * 1.4) * 0.4;
      });
      break;
    }
  }

  let previousPhase: number | null | undefined;
  return {
    container,
    update(current, phase) {
      if (current.type === 'long') {
        const remaining = current.missilesRemaining ?? 2;
        missiles.forEach((missile, index) => {
          missile.visible = index < remaining;
        });
      }
      if (phase === previousPhase) return;
      previousPhase = phase;
      for (const animate of motions) animate(phase);
    },
  };
}
