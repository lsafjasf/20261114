(function () {
  "use strict";

  const WORLD_WIDTH = 1600;
  const WORLD_HEIGHT = 900;

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawSky(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, 560);
    sky.addColorStop(0, "#1b3034");
    sky.addColorStop(0.3, "#3d4a4b");
    sky.addColorStop(0.57, "#865e5f");
    sky.addColorStop(0.77, "#d17e62");
    sky.addColorStop(1, "#efb378");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_WIDTH, 570);

    const lowerGlow = ctx.createLinearGradient(0, 390, 0, 610);
    lowerGlow.addColorStop(0, "rgba(255, 185, 116, 0)");
    lowerGlow.addColorStop(0.8, "rgba(255, 185, 116, 0.28)");
    lowerGlow.addColorStop(1, "rgba(255, 185, 116, 0)");
    ctx.fillStyle = lowerGlow;
    ctx.fillRect(0, 390, WORLD_WIDTH, 220);

    const sunGlow = ctx.createRadialGradient(1208, 224, 20, 1208, 224, 220);
    sunGlow.addColorStop(0, "rgba(255, 229, 171, 0.68)");
    sunGlow.addColorStop(0.35, "rgba(255, 199, 135, 0.2)");
    sunGlow.addColorStop(1, "rgba(255, 190, 125, 0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(930, 0, 560, 470);

    ctx.fillStyle = "#ffe0a1";
    ctx.beginPath();
    ctx.arc(1208, 224, 67, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 238, 193, 0.18)";
    ctx.beginPath();
    ctx.arc(1208, 224, 86, 0, Math.PI * 2);
    ctx.fill();

    drawClouds(ctx);

    const stars = [
      [190, 82, 1.3], [264, 145, 0.8], [393, 94, 1], [542, 63, 0.7],
      [668, 143, 1.1], [760, 84, 0.7], [895, 118, 1], [1040, 63, 0.8],
      [1370, 101, 1], [1475, 163, 0.7], [1300, 50, 0.7]
    ];
    ctx.fillStyle = "rgba(255, 241, 206, 0.65)";
    for (const [x, y, r] of stars) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawClouds(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(251, 218, 181, 0.16)";
    ctx.beginPath();
    ctx.moveTo(35, 202);
    ctx.bezierCurveTo(140, 179, 240, 192, 339, 200);
    ctx.bezierCurveTo(430, 205, 488, 196, 553, 208);
    ctx.bezierCurveTo(459, 226, 338, 224, 248, 218);
    ctx.bezierCurveTo(167, 215, 89, 220, 35, 202);
    ctx.fill();

    ctx.fillStyle = "rgba(245, 201, 162, 0.1)";
    ctx.beginPath();
    ctx.moveTo(833, 155);
    ctx.bezierCurveTo(950, 131, 1070, 147, 1152, 152);
    ctx.bezierCurveTo(1269, 157, 1340, 143, 1434, 163);
    ctx.bezierCurveTo(1321, 183, 1187, 177, 1080, 176);
    ctx.bezierCurveTo(971, 175, 889, 178, 833, 155);
    ctx.fill();

    ctx.strokeStyle = "rgba(250, 224, 191, 0.17)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(234, 304);
    ctx.bezierCurveTo(359, 294, 470, 301, 566, 300);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(978, 274);
    ctx.bezierCurveTo(1083, 264, 1196, 275, 1319, 265);
    ctx.stroke();
    ctx.restore();
  }

  function drawMountains(ctx) {
    ctx.fillStyle = "#6b5e60";
    ctx.beginPath();
    ctx.moveTo(0, 482);
    ctx.lineTo(0, 421);
    ctx.lineTo(112, 367);
    ctx.lineTo(207, 407);
    ctx.lineTo(315, 345);
    ctx.lineTo(419, 399);
    ctx.lineTo(541, 353);
    ctx.lineTo(650, 405);
    ctx.lineTo(765, 367);
    ctx.lineTo(892, 420);
    ctx.lineTo(1031, 376);
    ctx.lineTo(1149, 422);
    ctx.lineTo(1265, 363);
    ctx.lineTo(1382, 411);
    ctx.lineTo(1491, 373);
    ctx.lineTo(1600, 416);
    ctx.lineTo(1600, 510);
    ctx.lineTo(0, 510);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(240, 173, 123, 0.16)";
    ctx.beginPath();
    ctx.moveTo(0, 438);
    ctx.bezierCurveTo(272, 404, 452, 430, 696, 402);
    ctx.bezierCurveTo(924, 376, 1151, 429, 1371, 390);
    ctx.bezierCurveTo(1463, 375, 1542, 383, 1600, 402);
    ctx.lineTo(1600, 431);
    ctx.bezierCurveTo(1424, 419, 1276, 447, 1086, 430);
    ctx.bezierCurveTo(829, 408, 637, 464, 423, 439);
    ctx.bezierCurveTo(241, 419, 123, 449, 0, 461);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#4a5548";
    ctx.beginPath();
    ctx.moveTo(0, 508);
    ctx.bezierCurveTo(176, 480, 301, 494, 461, 477);
    ctx.bezierCurveTo(641, 458, 759, 495, 918, 479);
    ctx.bezierCurveTo(1098, 461, 1253, 491, 1400, 469);
    ctx.bezierCurveTo(1485, 457, 1544, 469, 1600, 460);
    ctx.lineTo(1600, 570);
    ctx.lineTo(0, 570);
    ctx.closePath();
    ctx.fill();
  }

  function drawGround(ctx) {
    const ground = ctx.createLinearGradient(0, 480, 0, WORLD_HEIGHT);
    ground.addColorStop(0, "#4b5944");
    ground.addColorStop(0.35, "#34483b");
    ground.addColorStop(1, "#172a26");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 500, WORLD_WIDTH, WORLD_HEIGHT - 500);

    ctx.fillStyle = "rgba(213, 174, 115, 0.12)";
    ctx.beginPath();
    ctx.moveTo(0, 575);
    ctx.bezierCurveTo(240, 543, 506, 590, 769, 554);
    ctx.bezierCurveTo(1001, 522, 1276, 576, 1600, 538);
    ctx.lineTo(1600, 622);
    ctx.bezierCurveTo(1314, 646, 1045, 604, 789, 634);
    ctx.bezierCurveTo(495, 667, 242, 622, 0, 651);
    ctx.closePath();
    ctx.fill();
  }

  function drawLake(ctx) {
    const lake = ctx.createLinearGradient(380, 620, 1040, 810);
    lake.addColorStop(0, "#385a5a");
    lake.addColorStop(0.55, "#274b4d");
    lake.addColorStop(1, "#193a3c");
    ctx.fillStyle = lake;
    ctx.beginPath();
    ctx.moveTo(290, 666);
    ctx.bezierCurveTo(409, 610, 560, 606, 681, 638);
    ctx.bezierCurveTo(782, 665, 903, 609, 1037, 632);
    ctx.bezierCurveTo(1164, 654, 1210, 711, 1163, 763);
    ctx.bezierCurveTo(1104, 828, 931, 831, 785, 804);
    ctx.bezierCurveTo(627, 774, 447, 803, 335, 755);
    ctx.bezierCurveTo(273, 728, 252, 693, 290, 666);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(219, 208, 165, 0.22)";
    ctx.lineWidth = 2;
    const ripples = [
      [425, 695, 141, 13], [615, 738, 190, 17], [862, 707, 155, 12],
      [736, 781, 104, 10], [945, 774, 123, 11], [351, 739, 76, 8]
    ];
    for (const [x, y, rx, ry] of ripples) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, -0.04, 0.08, Math.PI - 0.12);
      ctx.stroke();
    }

    const reflection = ctx.createLinearGradient(0, 655, 0, 786);
    reflection.addColorStop(0, "rgba(255, 198, 126, 0.28)");
    reflection.addColorStop(1, "rgba(255, 198, 126, 0)");
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.moveTo(1122, 660);
    ctx.lineTo(1187, 660);
    ctx.lineTo(1122, 790);
    ctx.lineTo(1012, 790);
    ctx.closePath();
    ctx.fill();
  }

  function drawWalkway(ctx) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(197, 157, 105, 0.23)";
    ctx.lineWidth = 98;
    ctx.beginPath();
    ctx.moveTo(394, 912);
    ctx.bezierCurveTo(470, 810, 509, 709, 634, 645);
    ctx.bezierCurveTo(741, 591, 871, 603, 1023, 548);
    ctx.bezierCurveTo(1128, 510, 1194, 470, 1261, 428);
    ctx.stroke();

    ctx.strokeStyle = "rgba(233, 202, 151, 0.2)";
    ctx.lineWidth = 2;
    ctx.setLineDash([17, 15]);
    ctx.beginPath();
    ctx.moveTo(394, 912);
    ctx.bezierCurveTo(470, 810, 509, 709, 634, 645);
    ctx.bezierCurveTo(741, 591, 871, 603, 1023, 548);
    ctx.bezierCurveTo(1128, 510, 1194, 470, 1261, 428);
    ctx.stroke();
    ctx.restore();
  }

  function drawDistantTown(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(62, 62, 57, 0.72)";
    const buildings = [
      [48, 452, 54, 86], [110, 432, 37, 106], [153, 459, 71, 79],
      [287, 450, 49, 91], [342, 466, 72, 72], [1373, 457, 54, 83],
      [1430, 438, 31, 102], [1467, 461, 73, 80], [1548, 447, 42, 96]
    ];
    for (const [x, y, w, h] of buildings) {
      ctx.fillRect(x, y, w, h);
      if ((w + h) % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + w / 2, y - 17);
        ctx.lineTo(x + w + 3, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.fillStyle = "rgba(255, 196, 112, 0.5)";
    const windows = [
      [60, 470], [80, 470], [127, 454], [172, 478], [302, 470],
      [322, 489], [361, 485], [1395, 478], [1412, 497], [1480, 486],
      [1502, 506], [1562, 467]
    ];
    for (const [x, y] of windows) {
      ctx.fillRect(x, y, 4, 3);
    }

    ctx.strokeStyle = "rgba(51, 53, 45, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1455, 438);
    ctx.lineTo(1455, 408);
    ctx.moveTo(1450, 412);
    ctx.lineTo(1460, 412);
    ctx.stroke();
    ctx.restore();
  }

  function drawFerrisWheel(ctx) {
    const cx = 1262;
    const cy = 430;
    const radius = 151;

    ctx.save();
    const halo = ctx.createRadialGradient(cx, cy, 20, cx, cy, 235);
    halo.addColorStop(0, "rgba(255, 189, 123, 0.11)");
    halo.addColorStop(1, "rgba(255, 189, 123, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(cx - 250, cy - 250, 500, 500);

    ctx.strokeStyle = "#c9b99c";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 98, cy + 201);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 98, cy + 201);
    ctx.stroke();

    ctx.strokeStyle = "rgba(63, 50, 42, 0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 129, cy + 207);
    ctx.lineTo(cx + 132, cy + 207);
    ctx.stroke();

    ctx.strokeStyle = "#d9c8a8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(221, 200, 164, 0.65)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 12, 0, Math.PI * 2);
    ctx.stroke();

    const spokeCount = 14;
    for (let i = 0; i < spokeCount; i += 1) {
      const angle = (i / spokeCount) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;

      ctx.strokeStyle = "rgba(216, 197, 163, 0.68)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();

      const cabinX = cx + Math.cos(angle) * (radius + 13);
      const cabinY = cy + Math.sin(angle) * (radius + 13) + 7;
      ctx.strokeStyle = "rgba(230, 213, 180, 0.7)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cabinX, cabinY - 8);
      ctx.stroke();

      ctx.fillStyle = i % 3 === 0 ? "#ef855d" : i % 3 === 1 ? "#f0d18d" : "#d95f43";
      roundedRect(ctx, cabinX - 6, cabinY - 5, 12, 10, 3);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 238, 186, 0.9)";
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#6a5140";
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e1c895";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(54, 66, 53, 0.8)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 209, 111, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPavilion(ctx) {
    const x = 306;
    const y = 492;
    ctx.save();
    const glow = ctx.createRadialGradient(x, y + 112, 8, x, y + 112, 116);
    glow.addColorStop(0, "rgba(255, 186, 99, 0.28)");
    glow.addColorStop(1, "rgba(255, 186, 99, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 130, y - 60, 260, 260);

    ctx.fillStyle = "#e8cf9e";
    ctx.beginPath();
    ctx.moveTo(x - 108, y + 70);
    ctx.bezierCurveTo(x - 73, y + 12, x - 38, y - 25, x, y - 42);
    ctx.bezierCurveTo(x + 39, y - 23, x + 68, y + 13, x + 108, y + 70);
    ctx.bezierCurveTo(x + 58, y + 55, x - 40, y + 60, x - 108, y + 70);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "#d77757";
    ctx.lineWidth = 11;
    for (let stripeX = x - 106; stripeX < x + 110; stripeX += 31) {
      ctx.beginPath();
      ctx.moveTo(stripeX, y + 78);
      ctx.lineTo(stripeX + 34, y - 31);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "#f0d296";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 108, y + 70);
    ctx.bezierCurveTo(x - 71, y + 50, x + 66, y + 53, x + 108, y + 70);
    ctx.stroke();

    ctx.fillStyle = "#3b3a32";
    ctx.fillRect(x - 91, y + 66, 6, 95);
    ctx.fillRect(x + 85, y + 66, 6, 95);
    ctx.fillRect(x - 5, y + 74, 5, 87);

    ctx.fillStyle = "#d9855f";
    roundedRect(ctx, x - 103, y + 71, 206, 8, 3);
    ctx.fill();
    ctx.fillStyle = "#f3cf8b";
    roundedRect(ctx, x - 80, y + 160, 160, 8, 3);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 215, 140, 0.85)";
    for (const lightX of [x - 72, x, x + 72]) {
      ctx.beginPath();
      ctx.arc(lightX, y + 77, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBoat(ctx) {
    ctx.save();
    ctx.translate(628, 724);
    ctx.rotate(-0.045);
    ctx.fillStyle = "#b95b40";
    ctx.beginPath();
    ctx.moveTo(-25, 0);
    ctx.quadraticCurveTo(0, 12, 27, 0);
    ctx.lineTo(18, 7);
    ctx.lineTo(-19, 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e9c486";
    ctx.beginPath();
    ctx.arc(0, -2, 4, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 220, 168, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -2, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 200, 115, 0.6)";
    ctx.beginPath();
    ctx.ellipse(0, 12, 36, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTree(ctx, x, y, scale, variant = 0) {
    const palettes = [
      ["#18352d", "#294c3d", "#48694b"],
      ["#20392d", "#34533e", "#5a704d"],
      ["#26382f", "#415842", "#6b7650"]
    ];
    const [dark, mid, light] = palettes[variant % palettes.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    ctx.fillStyle = "rgba(15, 27, 24, 0.35)";
    ctx.beginPath();
    ctx.ellipse(7, 7, 36, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#4c3d2f";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-2, -28, 8, -53, 2, -83);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -33);
    ctx.lineTo(-32, -59);
    ctx.moveTo(2, -48);
    ctx.lineTo(31, -70);
    ctx.stroke();

    const clusters = [
      [-31, -70, 25], [8, -91, 31], [38, -74, 24],
      [-20, -105, 20], [22, -111, 18], [2, -62, 28]
    ];
    for (let i = 0; i < clusters.length; i += 1) {
      const [cx, cy, r] = clusters[i];
      ctx.fillStyle = i % 3 === 0 ? dark : i % 3 === 1 ? mid : light;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(190, 196, 121, 0.18)";
    ctx.beginPath();
    ctx.arc(12, -104, 13, 0, Math.PI * 2);
    ctx.arc(-22, -82, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLamp(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    const glow = ctx.createRadialGradient(0, -55, 2, 0, -55, 45);
    glow.addColorStop(0, "rgba(255, 210, 133, 0.32)");
    glow.addColorStop(1, "rgba(255, 210, 133, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-45, -100, 90, 90);

    ctx.strokeStyle = "#1e2925";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -59);
    ctx.quadraticCurveTo(0, -69, 9, -69);
    ctx.stroke();

    ctx.fillStyle = "#f5c779";
    ctx.beginPath();
    ctx.arc(9, -65, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 245, 208, 0.9)";
    ctx.beginPath();
    ctx.arc(9, -65, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPeople(ctx) {
    const people = [
      [538, 709, "#e8a276", 0.92],
      [555, 713, "#33534e", 0.85],
      [904, 679, "#d96e50", 0.8],
      [920, 683, "#f0d49b", 0.75],
      [1118, 581, "#35534b", 0.84]
    ];
    for (const [x, y, color, scale] of people) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.strokeStyle = "#20312c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-3, 17);
      ctx.lineTo(0, 6);
      ctx.lineTo(3, 17);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-5, 6);
      ctx.lineTo(0, -5);
      ctx.lineTo(5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#322a24";
      ctx.beginPath();
      ctx.arc(0, -9, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBench(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#9b724c";
    roundedRect(ctx, -24, -3, 48, 5, 2);
    ctx.fill();
    ctx.fillRect(-18, 2, 3, 12);
    ctx.fillRect(15, 2, 3, 12);
    ctx.fillStyle = "rgba(46, 43, 34, 0.8)";
    roundedRect(ctx, -24, -17, 48, 5, 2);
    ctx.fill();
    ctx.fillRect(-19, -14, 2, 12);
    ctx.fillRect(17, -14, 2, 12);
    ctx.restore();
  }

  function drawForeground(ctx) {
    ctx.save();
    ctx.fillStyle = "#112822";
    ctx.beginPath();
    ctx.moveTo(0, 792);
    ctx.bezierCurveTo(106, 758, 206, 812, 303, 849);
    ctx.bezierCurveTo(205, 884, 100, 903, 0, 900);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(1600, 756);
    ctx.bezierCurveTo(1505, 786, 1408, 818, 1344, 864);
    ctx.bezierCurveTo(1434, 889, 1531, 900, 1600, 900);
    ctx.closePath();
    ctx.fill();

    const grass = [
      [110, 872, -0.17, 50], [175, 882, 0.06, 64], [229, 867, -0.05, 42],
      [1410, 879, 0.09, 64], [1463, 861, -0.04, 52], [1518, 881, 0.18, 70],
      [690, 629, 0.16, 27], [980, 807, -0.14, 38]
    ];
    ctx.strokeStyle = "#172f26";
    ctx.lineCap = "round";
    for (const [x, y, lean, height] of grass) {
      ctx.lineWidth = 4;
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(x + i * 7, y);
        ctx.quadraticCurveTo(x + i * 11 + lean * height, y - height * 0.55, x + i * 14 + lean * height, y - height);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(235, 158, 97, 0.72)";
    const flowers = [[1342, 871], [1375, 858], [1421, 880], [1568, 818], [91, 842]];
    for (const [x, y] of flowers) {
      ctx.beginPath();
      ctx.arc(x, y, 3.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBirds(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(50, 44, 42, 0.62)";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    const birds = [
      [705, 214, 1], [737, 202, 0.8], [765, 221, 0.65], [462, 254, 0.75]
    ];
    for (const [x, y, scale] of birds) {
      ctx.beginPath();
      ctx.moveTo(x - 8 * scale, y);
      ctx.quadraticCurveTo(x - 3 * scale, y - 4 * scale, x, y);
      ctx.quadraticCurveTo(x + 3 * scale, y - 4 * scale, x + 8 * scale, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGrain(ctx) {
    const tile = document.createElement("canvas");
    tile.width = 180;
    tile.height = 180;
    const tileCtx = tile.getContext("2d");
    let seed = 8941;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 460; i += 1) {
      const value = random() > 0.5 ? 255 : 0;
      tileCtx.fillStyle = `rgba(${value}, ${value}, ${value}, ${0.1 + random() * 0.25})`;
      tileCtx.fillRect(random() * 180, random() * 180, 1 + random() * 1.3, 1 + random() * 1.3);
    }
    const pattern = ctx.createPattern(tile, "repeat");
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.restore();
  }

  function drawAtmosphere(ctx) {
    const haze = ctx.createLinearGradient(0, 330, 0, 690);
    haze.addColorStop(0, "rgba(255, 191, 132, 0.07)");
    haze.addColorStop(0.55, "rgba(255, 191, 132, 0.015)");
    haze.addColorStop(1, "rgba(22, 44, 39, 0.14)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 330, WORLD_WIDTH, 360);

    const vignette = ctx.createRadialGradient(
      WORLD_WIDTH * 0.52, WORLD_HEIGHT * 0.48, WORLD_HEIGHT * 0.3,
      WORLD_WIDTH * 0.52, WORLD_HEIGHT * 0.48, WORLD_WIDTH * 0.7
    );
    vignette.addColorStop(0, "rgba(9, 17, 18, 0)");
    vignette.addColorStop(0.74, "rgba(9, 17, 18, 0.05)");
    vignette.addColorStop(1, "rgba(9, 17, 18, 0.35)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  function drawStaticScene(ctx) {
    drawSky(ctx);
    drawMountains(ctx);
    drawGround(ctx);
    drawDistantTown(ctx);
    drawLake(ctx);
    drawWalkway(ctx);
    drawFerrisWheel(ctx);
    drawPavilion(ctx);
    drawBoat(ctx);

    drawTree(ctx, 112, 543, 0.74, 1);
    drawTree(ctx, 387, 536, 0.55, 0);
    drawTree(ctx, 720, 573, 0.5, 2);
    drawTree(ctx, 1064, 627, 0.76, 0);
    drawTree(ctx, 1438, 642, 0.98, 1);
    drawTree(ctx, 1529, 687, 1.08, 0);
    drawTree(ctx, 191, 744, 1.12, 1);
    drawTree(ctx, 1458, 792, 1.36, 2);
    drawTree(ctx, 1233, 732, 0.85, 1);
    drawTree(ctx, 84, 884, 1.42, 0);
    drawTree(ctx, 1560, 877, 1.48, 1);

    drawLamp(ctx, 506, 704, 0.95);
    drawLamp(ctx, 871, 652, 0.8);
    drawLamp(ctx, 1141, 564, 0.72);
    drawBench(ctx, 574, 676, 0.9);
    drawBench(ctx, 958, 624, 0.82);
    drawPeople(ctx);
    drawBirds(ctx);
    drawForeground(ctx);
    drawAtmosphere(ctx);
    drawGrain(ctx);
  }

  let cachedWorld = null;

  function buildWorldCanvas() {
    if (cachedWorld) return cachedWorld;
    const canvas = document.createElement("canvas");
    canvas.width = WORLD_WIDTH;
    canvas.height = WORLD_HEIGHT;
    const ctx = canvas.getContext("2d");
    drawStaticScene(ctx);
    cachedWorld = canvas;
    return canvas;
  }

  window.MotionScene = {
    WORLD_WIDTH,
    WORLD_HEIGHT,
    buildWorldCanvas
  };
})();
