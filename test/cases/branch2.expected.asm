0801: A9 10        LDA #$10
0803: 8D 11 08     STA $0811
0806: A9 08        LDA #$08
0808: 8D 12 08     STA $0812
080B: 6C 11 08     JMP ($0811)
080E: D0 00        BNE $0810
0810: 60           RTS
0811: 00           BRK
0812: 00           BRK