

;; acme --cpu 6510 --format cbm --outfile foo.prg foo.asm
;* = $0801                             ; BASIC start address (#2049)
;!byte $0d,$08,$dc,$07,$9e,$20,$34,$39 ; BASIC loader to start at $c000...
;!byte $31,$35,$32,$00,$00,$00         ; puts BASIC line 2012 SYS 49152
;* = $c000                             ; start address for 6502 code

start:
    jmp real_start

* = $c000
real_start:
    lda #0
    sta $d020
    lda #0
    sta $d021

    ldx #$00
loop:
    lda screen_002+2+0*$100,x
    sta $0400+0*$100,x
    lda screen_002+2+25*40+0*$100,x
    sta $d800+0*$100,x

    lda screen_002+2+1*$100,x
    sta $0400+1*$100,x
    lda screen_002+2+25*40+1*$100,x
    sta $d800+1*$100,x

    lda screen_002+2+2*$100,x
    sta $0400+2*$100,x
    lda screen_002+2+25*40+2*$100,x
    sta $d800+2*$100,x

    lda screen_002+2+$2e8,x
    sta $0400+$2e8,x
    lda screen_002+2+25*40+$2e8,x
    sta $d800+$2e8,x
    inx
    nop
    bne loop

infloop:
wait_first_line:
    ldx $d012
    lda $d011
    and #$80
    bne wait_first_line
    cpx #0
    bne wait_first_line
    jmp infloop

screen_002:
!byte 0,0
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,126,193,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,193,228,232,92,32,32,255,160,160,225,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,199,28,32,32,59,32,32,32,95,126,103,160,244,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,225,241,248,233,32,32,32,32,32,32,32,243,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,231,32,220,198,196,71,32,32,32,32,32,32,206,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,32,36,172,162,246,85,32,32,32,32,103,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,32,94,249,119,32,32,32,32,32,32,32,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,231,32,32,233,227,247,227,252,32,32,32,103,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,32,225,239,249,160,160,236,92,32,32,32,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,32,229,127,126,118,217,32,32,32,32,78,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,231,32,220,167,189,160,234,251,189,44,32,32,229,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,231,123,225,160,160,160,232,32,105,32,32,32,229,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,123,220,160,160,252,32,32,92,32,32,108,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,230,160,160,160,127,32,32,32,103,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,230,187,108,32,32,32,32,225,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,116,230,226,196,123,32,32,245,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,97,32,226,120,39,32,32,225,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,160,116,32,32,32,32,32,32,32,230,232,160,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,160,232,105,32,32,32,32,32,32,32,32,32,230,205,160,160,160,160,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,160,160,160,206,230,32,32,77,32,32,32,32,32,32,32,230,160,197,195,210,228,160,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,160,236,195,197,230,230,32,32,32,32,45,78,32,32,32,32,32,230,160,160,160,160,205,160,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,175,227,160,230,160,230,32,32,32,104,32,32,32,32,32,32,104,230,230,160,230,230,160,220,160,160,160,160,160,160,160
!byte 160,160,160,160,160,160,160,160,160,230,160,160,160,160,230,230,32,32,32,32,32,32,108,230,230,230,230,230,220,230,230,160,162,195,160,160,160,160,160,160
!byte 160,160,160,160,160,160,206,160,230,230,232,160,160,230,160,160,230,32,32,32,32,225,160,230,230,230,230,230,230,230,230,160,230,160,205,160,160,160,160,160
!byte 160,160,160,160,160,167,160,160,230,230,160,160,160,160,160,160,230,230,230,223,233,160,160,160,230,230,230,230,230,230,230,230,230,230,230,232,160,160,160,160
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,12,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,15,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,15,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,15,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,11,12,12,12,11,12,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,11,11,12,11,11,11,12,12,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,12,15,12,12,12,12,12,12,12,12,12,12,12,12,12,12,15,12,12,12,11,11,11,11,11,12,11,12,12,12,12,12,12,12
!byte 12,12,12,12,12,12,15,15,12,12,12,12,12,12,12,12,11,11,12,12,12,12,15,15,12,12,12,11,11,11,11,11,11,11,11,12,12,12,12,12
